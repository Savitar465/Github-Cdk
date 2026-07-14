# Crea el rol IAM que GitHub Actions asume via OIDC para desplegar los
# microservicios de IA. Sin credenciales guardadas en GitHub: AWS confia
# criptograficamente en los workflows de main de los repos indicados.
#
# Uso:  .\create-deploy-role.ps1 -GithubOwner "tu-usuario-de-github"
param(
    [Parameter(Mandatory = $true)][string]$GithubOwner
)
$ErrorActionPreference = 'Stop'
$env:AWS_CA_BUNDLE = 'C:\ProgramData\Avast Software\Avast\wscert.pem'

$cuenta = '534120921155'
$rol = 'github-actions-ai-deploy'
$scratch = $env:TEMP

$trust = @{
    Version = '2012-10-17'
    Statement = @(@{
        Effect = 'Allow'
        Principal = @{ Federated = "arn:aws:iam::${cuenta}:oidc-provider/token.actions.githubusercontent.com" }
        Action = 'sts:AssumeRoleWithWebIdentity'
        Condition = @{
            StringEquals = @{ 'token.actions.githubusercontent.com:aud' = 'sts.amazonaws.com' }
            StringLike = @{ 'token.actions.githubusercontent.com:sub' = @(
                "repo:${GithubOwner}/Github-issue-classifier-ms:ref:refs/heads/main",
                "repo:${GithubOwner}/Github-commit-summarizer-ms:ref:refs/heads/main"
            ) }
        }
    })
} | ConvertTo-Json -Depth 10
Set-Content "$scratch\trust.json" -Value $trust -Encoding ASCII

$politica = @{
    Version = '2012-10-17'
    Statement = @(
        @{  # login a ECR (la API lo exige sobre *)
            Effect = 'Allow'; Action = 'ecr:GetAuthorizationToken'; Resource = '*'
        },
        @{  # push/pull SOLO en los dos repos de IA
            Effect = 'Allow'
            Action = @('ecr:BatchCheckLayerAvailability','ecr:CompleteLayerUpload',
                       'ecr:InitiateLayerUpload','ecr:PutImage','ecr:UploadLayerPart',
                       'ecr:BatchGetImage','ecr:GetDownloadUrlForLayer')
            Resource = @(
                "arn:aws:ecr:us-east-1:${cuenta}:repository/github/issue-classifier-ms",
                "arn:aws:ecr:us-east-1:${cuenta}:repository/github/commit-summarizer-ms"
            )
        },
        @{  # localizar y reciclar los servicios en el cluster
            Effect = 'Allow'; Action = @('ecs:ListServices','ecs:DescribeServices'); Resource = '*'
        },
        @{
            Effect = 'Allow'; Action = 'ecs:UpdateService'
            Resource = "arn:aws:ecs:us-east-1:${cuenta}:service/github-ecs/*"
        }
    )
} | ConvertTo-Json -Depth 10
Set-Content "$scratch\politica.json" -Value $politica -Encoding ASCII

try {
    aws iam create-role --role-name $rol --assume-role-policy-document "file://$scratch\trust.json" --query "Role.Arn" --output text
} catch {
    Write-Output "El rol ya existia; actualizo la politica de confianza"
    aws iam update-assume-role-policy --role-name $rol --policy-document "file://$scratch\trust.json"
}
aws iam put-role-policy --role-name $rol --policy-name deploy-permissions --policy-document "file://$scratch\politica.json"

Write-Output ""
Write-Output "ROL LISTO: arn:aws:iam::${cuenta}:role/${rol}"
Write-Output "Configurar en CADA repo de GitHub (Settings -> Secrets and variables -> Actions -> Variables):"
Write-Output "  AWS_DEPLOY_ROLE_ARN = arn:aws:iam::${cuenta}:role/${rol}"
