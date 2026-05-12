import * as cdk from 'aws-cdk-lib';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

import { EnvironmentConfig } from '../../config/app-config';
import {
  EcsCluster,
  FilesMsEcsService,
  FrontendEcsService,
  GitServerEcsService,
  GithubApiGateway,
  GithubDatabase,
  GithubVpc,
  KeycloakEcsService,
  MongoDbEcsService,
  OrganizationsMsEcsService,
  PullRequestMsEcsService,
  RepositoryMsEcsService,
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
        props.prDbName,
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
    });

    // ── Git SSH/HTTP server ───────────────────────────────────────────────────
    // Reachable within the VPC at git-server.github.local:9080.
    new GitServerEcsService(this, 'GitServer', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      microserviceUrl: props.gitServerMicroserviceUrl,
      microserviceAuthToken: props.gitServerMicroserviceAuthToken,
      placeTasksInPublicSubnets: noNat,
    });

    // ── Repository microservice ───────────────────────────────────────────────
    // Connects to MongoDB. Reachable publicly via ALB and internally at repository-ms.github.local:8090.
    const repositoryService = new RepositoryMsEcsService(this, 'RepositoryMs', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
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
    // const pullRequestService = new PullRequestMsEcsService(this, 'PullRequestMs', {
    //   cluster: ecsCluster.cluster,
    //   vpc: network.vpc,
    //   dbSecurityGroup: database.securityGroup,
    //   dbHost: database.endpointAddress,
    //   dbPort: props.prDbPort,
    //   dbName: props.prDbName,
    //   dbUsername: props.prDbUsername,
    //   dbPassword: props.prDbPassword,
    //   jwtIssuerUri: props.prJwtIssuerUri,
    //   oauth2Enabled: props.prOauth2Enabled,
    //   springProfilesActive: props.prSpringProfilesActive,
    //   serverPort: props.prServerPort,
    //   placeTasksInPublicSubnets: noNat,
    // });

    // files-ms and pullrequest-ms must wait for the DB-init trigger so their
    // databases exist before the containers try to connect.
    // if (database.dbInitTrigger) {
    //   filesService.service.node.addDependency(database.dbInitTrigger);
    //   pullRequestService.service.node.addDependency(database.dbInitTrigger);
    // }

    // ── Organizations microservice ────────────────────────────────────────────
    // Connects to PostgreSQL. Reachable at organizations-ms.github.local:8085.
    const orgService = new OrganizationsMsEcsService(this, 'OrganizationsMs', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
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

    // ── Frontend (public ALB) ─────────────────────────────────────────────────
    const frontendService = new FrontendEcsService(this, 'Frontend', {
      cluster: ecsCluster.cluster,
      vpc: network.vpc,
      filesApiUrl: props.frontFilesApiUrl,
      usersApiUrl: props.frontUsersApiUrl,
      repositoryApiUrl: props.frontRepositoryApiUrl,
      prApiUrl: props.frontPrApiUrl,
      orgApiUrl: props.frontOrgApiUrl,
      issuesApiUrl: props.frontIssuesApiUrl,
      keycloakUrl: `http://${keycloakService.loadBalancer.loadBalancerDnsName}`,
      keycloakRealm: props.keycloakRealmName,
      keycloakClientId: props.keycloakClientId,
      useKeycloak: props.frontUseKeycloak,
      useMockAuth: props.frontUseMockAuth,
      gitHttpUrl: props.frontGitHttpUrl,
      gitSshHost: props.frontGitSshHost,
      gitSshPort: props.frontGitSshPort,
      placeTasksInPublicSubnets: noNat,
    });

    // ── API Gateway → Cloud Map → users service ───────────────────────────────
    if (usersService.cloudMapService) {
      new GithubApiGateway(this, 'ApiGateway', {
        vpc: network.vpc,
        cloudMapService: usersService.cloudMapService,
        usersTaskSecurityGroup: usersService.taskSecurityGroup,
        serverPort: props.usersServerPort,
        placeVpcLinkInPublicSubnets: noNat,
      });
    }

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