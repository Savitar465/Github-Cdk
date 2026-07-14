import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

import { EnvironmentConfig } from '../../config/app-config';
import {
  AiEcsService,
  EcsCluster,
  FilesMsEcsService,
  FrontendEcsService,
  GitServerEcsService,
  GithubDatabase,
  GithubVpc,
  IssuesMsEcsService,
  KeycloakEcsService,
  MongoDbEcsService,
  OrganizationsMsEcsService,
  PullRequestMsEcsService,
  RepositoryMsEcsService,
  SharedApiAlb,
  UsersEcsService,
} from '../constructs';

export interface KeycloakStackProps extends cdk.StackProps, EnvironmentConfig {}

/**
 * Top-level stack for the Keycloak deployment on ECS (EC2 launch type).
 *
 * Wires together:
 *   - {@link GithubVpc}         → VPC with public + private subnets
 *   - {@link EcsCluster}        → EC2-backed ECS cluster
 *   - {@link GithubDatabase}    → RDS PostgreSQL
 *   - {@link KeycloakEcsService}→ Keycloak ECS service + ALB
 *
 * Free-tier / dev mode (VPC_NAT_GATEWAYS=0):
 *   Both EC2 instances and ECS tasks are placed in public subnets so they can
 *   reach ECR and CloudWatch without NAT gateways.  RDS is placed in isolated
 *   subnets and only reachable from the task security group.
 */
export class KeycloakStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: KeycloakStackProps) {
    super(scope, id, props);

    // Tasks and EC2 instances need public subnets when there are no NAT gateways.
    const noNat = props.vpcNatGateways === 0;

    // ── Docker Hub pull credentials ───────────────────────────────────────────
    const dockerHubSecret = props.dockerhubSecretName
      ? secretsmanager.Secret.fromSecretNameV2(this, 'DockerHubSecret', props.dockerhubSecretName)
      : undefined;

    // ── Network ───────────────────────────────────────────────────────────────
    const network = new GithubVpc(this, 'Network', {
      maxAzs: props.vpcMaxAzs,
      natGateways: props.vpcNatGateways,
    });

    // ── ECS Cluster ───────────────────────────────────────────────────────────
    const ecsCluster = new EcsCluster(this, 'EcsCluster', {
      vpc: network.vpc,
      clusterName: props.clusterName,
    });
    // ── Service Discovery (Cloud Map private DNS namespace) ───────────────────
    // Services register under github.local so they can reach each other via DNS
    // (e.g. users.github.local, keycloak.github.local) without leaving the VPC.
    ecsCluster.cluster.addDefaultCloudMapNamespace({
      name: 'github.local',
      type: servicediscovery.NamespaceType.DNS_PRIVATE,
      vpc: network.vpc,
    });

    // ── Database ──────────────────────────────────────────────────────────────
    const database = new GithubDatabase(this, 'Database', {
      vpc: network.vpc,
      dbPassword: props.dbPassword,
      dbName: props.dbName,
      additionalDatabases: [
        props.usersDbName, props.filesDbName, props.prDbName, props.orgDbName,
        props.issuesDbName, props.issuesDbName
      ],
      multiAz: props.rdsMultiAz,
      instanceType: props.rdsInstanceType,
      allocatedStorageGb: props.rdsAllocatedStorageGb,
      engineVersion: props.rdsEngineVersion,
      publiclyAccessible: props.rdsPubliclyAccessible,
    });

    // ── Keycloak on ECS ───────────────────────────────────────────────────────
    const keycloakService = new KeycloakEcsService(this, 'KeycloakService', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      dbSecurityGroup: database.securityGroup,
      keycloakHostname: props.keycloakHostname,
      keycloakAdminUser: props.keycloakAdminUser,
      keycloakAdminPassword: props.keycloakAdminPassword,
      dbHost: database.endpointAddress,
      dbName: props.dbName,
      dbPassword: props.dbPassword,
      replicas: props.keycloakReplicas,
      // Mirror the cluster placement: no NAT → tasks go into public subnets.
      placeTasksInPublicSubnets: noNat,
    });

    // ── Users microservice ────────────────────────────────────────────────────
    const usersService = new UsersEcsService(this, 'UsersService', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      placeTasksInPublicSubnets: noNat,
      dockerHubSecret,
      dbSecurityGroup: database.securityGroup,
      dbHost: database.endpointAddress,
      dbName: props.usersDbName,
      dbPassword: props.dbPassword,
      serverPort: props.usersServerPort,
      springAppName: props.usersSpringAppName,
      keycloakIssuerUri: props.keycloakIssuerUri,
      keycloakJwkSetUri: props.keycloakJwkSetUri,
      keycloakClientId: props.keycloakClientId,
      keycloakClientSecret: props.keycloakClientSecret,
      keycloakAuthGrantType: props.keycloakAuthGrantType,
      keycloakScope: props.keycloakScope,
      keycloakServerUrl: props.keycloakServerUrl,
      keycloakRealm: props.keycloakRealmName,
      keycloakAdminClient: props.keycloakAdminClient,
      keycloakAdminClientSecret: props.keycloakAdminClientSecret,
    });

    // Both services must wait for the DB-init trigger so that the `keycloak`
    // and `ms-users` databases exist before any container tries to connect.
    if (database.dbInitTrigger) {
      keycloakService.service.node.addDependency(database.dbInitTrigger);
      usersService.service.node.addDependency(database.dbInitTrigger);
    }

    // ── MongoDB on ECS ────────────────────────────────────────────────────────
    // Reachable within the VPC at mongodb.github.local:27017.
    // MongoDB uses binary TCP — it cannot be routed through HTTP API Gateway.
    new MongoDbEcsService(this, 'MongoDb', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      mongodbPassword: props.mongodbPassword,
      mongodbUsername: props.mongodbUsername,
      placeTasksInPublicSubnets: noNat,
      dockerHubSecret,
    });

    // ── Git SSH/HTTP server ───────────────────────────────────────────────────
    // Reachable within the VPC at git-server.github.local:9080.
    new GitServerEcsService(this, 'GitServer', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      microserviceUrl: props.gitServerMicroserviceUrl,
      microserviceAuthToken: props.gitServerMicroserviceAuthToken,
      placeTasksInPublicSubnets: noNat,
      dockerHubSecret,
    });

    // ── Repository microservice ───────────────────────────────────────────────
    // Connects to MongoDB. Reachable publicly via ALB and internally at repository-ms.github.local:8090.
    const repositoryService = new RepositoryMsEcsService(this, 'RepositoryMs', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      dockerHubSecret,
      mongoHost: props.repoMongoHost,
      mongoPort: props.repoMongoPort,
      mongoDatabase: props.repoMongoDatabase,
      mongoUsername: props.repoMongoUsername,
      mongoPassword: props.repoMongoPassword,
      mongoAuthDatabase: props.repoMongoAuthDatabase,
      serverPort: props.repoServerPort,
      gitServerHttpUrl: props.repoGitServerHttpUrl,
      gitServerSshHost: props.repoGitServerSshHost,
      gitServerSshPort: props.repoGitServerSshPort,
      microserviceAuthToken: props.repoMicroserviceAuthToken,
      jwtIssuerUri: props.repoJwtIssuerUri,
      jwtJwkSetUri: props.repoJwtJwkSetUri,
      keycloakHost: props.repoKeycloakHost,
      keycloakPort: props.repoKeycloakPort,
      keycloakRealm: props.repoKeycloakRealm,
      placeTasksInPublicSubnets: noNat,
    });

    // ── Files microservice ────────────────────────────────────────────────────
    // Connects to PostgreSQL. Reachable at files-ms.github.local:8083.
    // const filesService = new FilesMsEcsService(this, 'FilesMs', {
    //   cluster: ecsCluster.cluster,
    //   vpc: network.vpc,
    //   dbSecurityGroup: database.securityGroup,
    //   dbHost: database.endpointAddress,
    //   dbPort: props.filesDbPort,
    //   dbName: props.filesDbName,
    //   dbUsername: props.filesDbUsername,
    //   dbPassword: props.filesDbPassword,
    //   jwtIssuerUri: props.filesJwtIssuerUri,
    //   oauth2Enabled: props.filesOauth2Enabled,
    //   serverPort: props.filesServerPort,
    //   placeTasksInPublicSubnets: noNat,
    // });

    // ── Pull-request microservice ─────────────────────────────────────────────
    // Connects to PostgreSQL. Reachable at pullrequest-ms.github.local:8084.
    const pullRequestService = new PullRequestMsEcsService(this, 'PullRequestMsV3', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      dockerHubSecret,
      dbSecurityGroup: database.securityGroup,
      dbHost: database.endpointAddress,
      dbPort: props.prDbPort,
      dbName: props.prDbName,
      dbUsername: props.prDbUsername,
      dbPassword: props.prDbPassword,
      jwtIssuerUri: props.prJwtIssuerUri,
      oauth2Enabled: props.prOauth2Enabled,
      springProfilesActive: props.prSpringProfilesActive,
      serverPort: props.prServerPort,
      repositoryMsUrl: props.prRepositoryMsUrl,
      placeTasksInPublicSubnets: noNat,
      logGroupName: '/ecs/pullrequest-ms-v3',
      cloudMapName: 'pullrequest-ms',
    });

    if (database.dbInitTrigger) {
      pullRequestService.service.node.addDependency(database.dbInitTrigger);
    }

    // ── Organizations microservice ────────────────────────────────────────────
    // Connects to PostgreSQL. Reachable at organizations-ms.github.local:8085.
    const orgService = new OrganizationsMsEcsService(this, 'OrganizationsMs', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      dockerHubSecret,
      dbSecurityGroup: database.securityGroup,
      dbHost: database.endpointAddress,
      dbPort: props.orgDbPort,
      dbName: props.orgDbName,
      dbUsername: props.orgDbUsername,
      dbPassword: props.orgDbPassword,
      sslCertPath: props.orgSslCertPath,
      jwtIssuerUri: props.orgJwtIssuerUri,
      jwtJwkSetUri: props.orgJwtJwkSetUri,
      serverPort: props.orgServerPort,
      placeTasksInPublicSubnets: noNat,
    });

    if (database.dbInitTrigger) {
      orgService.service.node.addDependency(database.dbInitTrigger);
    }

    // ── Issues microservice ───────────────────────────────────────────────────
    // Connects to PostgreSQL. Reachable at issues-ms.github.local:8091.
    const issuesService = new IssuesMsEcsService(this, 'IssuesMs', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      dockerHubSecret,
      dbSecurityGroup: database.securityGroup,
      dbHost: database.endpointAddress,
      dbPort: props.issuesDbPort,
      dbName: props.issuesDbName,
      dbUsername: props.issuesDbUsername,
      dbPassword: props.issuesDbPassword,
      sslCertPath: props.issuesSslCertPath,
      jwtIssuerUri: props.issuesJwtIssuerUri,
      jwtJwkSetUri: props.issuesJwtJwkSetUri,
      serverPort: props.issuesServerPort,
      grpcPort: props.issuesGrpcPort,
      placeTasksInPublicSubnets: noNat,
    });

    if (database.dbInitTrigger) {
      issuesService.service.node.addDependency(database.dbInitTrigger);
    }

    // ── Shared API ALB ────────────────────────────────────────────────────────
    // Public entry point for the APIs the browser calls directly:
    // organizations, issues, users and pull-requests.
    const sharedApiAlb = new SharedApiAlb(this, 'SharedApiAlb', {
      vpc: network.vpc,
      services: [
        {
          name: 'organizations',
          service: orgService.service,
          port: props.orgServerPort,
          taskSecurityGroup: orgService.taskSecurityGroup,
        },
        {
          name: 'issues',
          service: issuesService.service,
          port: props.issuesServerPort,
          taskSecurityGroup: issuesService.taskSecurityGroup,
        },
        {
          name: 'users',
          service: usersService.service,
          port: props.usersServerPort,
          taskSecurityGroup: usersService.taskSecurityGroup,
        },
        {
          name: 'pullrequest',
          service: pullRequestService.service,
          port: props.prServerPort,
          taskSecurityGroup: pullRequestService.taskSecurityGroup,
          // The PR service runs with servlet context-path /api
          healthCheckPath: '/api/actuator/health',
        },
      ],
    });

    // Spring Boot takes ~90s to start; without a grace period the ALB marks the
    // task unhealthy mid-startup and the deployment circuit breaker rolls back.
    for (const svc of [orgService.service, issuesService.service, usersService.service, pullRequestService.service]) {
      (svc.node.defaultChild as ecs.CfnService).healthCheckGracePeriodSeconds = 300;
    }

    // ── Microservicios de IA (internos, sin exposición pública) ──────────────
    // El frontend los alcanza vía sus rewrites de Next.js dentro de la VPC.
    new AiEcsService(this, 'IssueClassifierMs', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      cloudMapName: 'issue-classifier-ms',
      ecrRepositoryName: 'github/issue-classifier-ms',
      serverPort: 8095,
      logGroupName: '/ecs/issue-classifier-ms',
      jwtIssuerUri: props.orgJwtIssuerUri,
      jwtJwkSetUri: props.orgJwtJwkSetUri,
      placeTasksInPublicSubnets: noNat,
    });

    new AiEcsService(this, 'CommitSummarizerMs', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      cloudMapName: 'commit-summarizer-ms',
      ecrRepositoryName: 'github/commit-summarizer-ms',
      serverPort: 8096,
      logGroupName: '/ecs/commit-summarizer-ms',
      jwtIssuerUri: props.orgJwtIssuerUri,
      jwtJwkSetUri: props.orgJwtJwkSetUri,
      placeTasksInPublicSubnets: noNat,
    });

    // ── Frontend (public ALB) ─────────────────────────────────────────────────
    const frontendService = new FrontendEcsService(this, 'Frontend', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      dockerHubSecret,
      // Literal URLs from .env: they are baked into the Next.js client bundle
      // as Docker build args, which cannot carry deploy-time tokens.
      filesApiUrl: props.frontFilesApiUrl,
      usersApiUrl: props.frontUsersApiUrl,
      repositoryApiUrl: props.frontRepositoryApiUrl,
      prApiUrl: props.frontPrApiUrl,
      orgApiUrl: props.frontOrgApiUrl,
      issuesApiUrl: props.frontIssuesApiUrl,
      keycloakUrl: props.keycloakServerUrl,
      keycloakRealm: props.keycloakRealmName,
      keycloakClientId: props.keycloakClientId,
      useKeycloak: props.frontUseKeycloak,
      useMockAuth: props.frontUseMockAuth,
      gitHttpUrl: props.frontGitHttpUrl,
      gitSshHost: props.frontGitSshHost,
      gitSshPort: props.frontGitSshPort,
      placeTasksInPublicSubnets: noNat,
    });


    // ── CloudFormation Outputs ────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ClusterName', {
      value: ecsCluster.cluster.clusterName,
      description: 'ECS cluster name',
      exportName: `${this.stackName}-ClusterName`,
    });

    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: database.endpointAddress,
      description: 'RDS PostgreSQL endpoint',
      exportName: `${this.stackName}-DbEndpoint`,
    });

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: keycloakService.loadBalancer.loadBalancerDnsName,
      description: 'Application Load Balancer DNS name',
      exportName: `${this.stackName}-LoadBalancerDns`,
    });

    new cdk.CfnOutput(this, 'UsersServiceDiscoveryDns', {
      value: 'users.github.local',
      description: 'DNS name for the users microservice (reachable from within the VPC)',
      exportName: `${this.stackName}-UsersServiceDiscoveryDns`,
    });

    new cdk.CfnOutput(this, 'MongoDbServiceDiscoveryDns', {
      value: `mongodb.github.local`,
      description: 'DNS name for MongoDB (reachable from within the VPC on port 27017)',
      exportName: `${this.stackName}-MongoDbServiceDiscoveryDns`,
    });

    new cdk.CfnOutput(this, 'OrganizationsMsServiceDiscoveryDns', {
      value: 'organizations-ms.github.local',
      description: 'DNS name for the organizations microservice (reachable from within the VPC on port 8085)',
      exportName: `${this.stackName}-OrganizationsMsServiceDiscoveryDns`,
    });

    new cdk.CfnOutput(this, 'IssuesMsServiceDiscoveryDns', {
      value: 'issues-ms.github.local',
      description: 'DNS name for the issues microservice (reachable from within the VPC on port 8091)',
      exportName: `${this.stackName}-IssuesMsServiceDiscoveryDns`,
    });

    new cdk.CfnOutput(this, 'SharedApiAlbDns', {
      value: sharedApiAlb.loadBalancer.loadBalancerDnsName,
      description: 'Public DNS of the shared API ALB (organizations :8085, issues :8091)',
      exportName: `${this.stackName}-SharedApiAlbDns`,
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: `http://${frontendService.loadBalancer.loadBalancerDnsName}`,
      description: 'Public URL for the frontend application',
      exportName: `${this.stackName}-FrontendUrl`,
    });

    new cdk.CfnOutput(this, 'GitServerServiceDiscoveryDns', {
      value: 'git-server.github.local',
      description: 'DNS name for the Git SSH/HTTP server (reachable from within the VPC on port 9080)',
      exportName: `${this.stackName}-GitServerServiceDiscoveryDns`,
    });

    new cdk.CfnOutput(this, 'RepositoryMsUrl', {
      value: `http://${repositoryService.loadBalancer.loadBalancerDnsName}`,
      description: 'Public URL for the repository microservice',
      exportName: `${this.stackName}-RepositoryMsUrl`,
    });

    new cdk.CfnOutput(this, 'RepositoryMsServiceDiscoveryDns', {
      value: 'repository-ms.github.local',
      description: 'DNS name for the repository microservice (reachable from within the VPC on port 8090)',
      exportName: `${this.stackName}-RepositoryMsServiceDiscoveryDns`,
    });

    // new cdk.CfnOutput(this, 'FilesMsServiceDiscoveryDns', {
    //   value: 'files-ms.github.local',
    //   description: 'DNS name for the files microservice (reachable from within the VPC on port 8083)',
    //   exportName: `${this.stackName}-FilesMsServiceDiscoveryDns`,
    // });

    // new cdk.CfnOutput(this, 'PullRequestMsServiceDiscoveryDns', {
    //   value: 'pullrequest-ms.github.local',
    //   description: 'DNS name for the pull-request microservice (reachable from within the VPC on port 8084)',
    //   exportName: `${this.stackName}-PullRequestMsServiceDiscoveryDns`,
    // });

  }
}