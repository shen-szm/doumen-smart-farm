# 发布脚本的连接参数，被 publish.sh / rollback.sh / ssh-server.sh / scp-server.sh 共用。
# 访问方式变更时只改这里；也可用同名环境变量临时覆盖。
export DOUMEN_ECS_HOST="${DOUMEN_ECS_HOST:-8.138.151.152}"
export DOUMEN_ECS_KEY="${DOUMEN_ECS_KEY:-$HOME/.ssh/aliyun-doumen.pem}"
export DOUMEN_MGMT_KEY="${DOUMEN_MGMT_KEY:-$HOME/.ssh/doumen-mgmt}"
export DOUMEN_MGMT_USER="${DOUMEN_MGMT_USER:-doumen_deploy}"
export DOUMEN_MGMT_PORT="${DOUMEN_MGMT_PORT:-2222}"
# 站点在服务器电脑上的目录
export DOUMEN_SERVER_DIR="C:\\doumen"

# StrictHostKeyChecking=yes：主机密钥对不上就拒绝连接，不自动信任新密钥。
DOUMEN_SSH_OPTS=(
  -o "ProxyCommand=ssh -i $DOUMEN_ECS_KEY -W %h:%p root@$DOUMEN_ECS_HOST"
  -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=25
)
