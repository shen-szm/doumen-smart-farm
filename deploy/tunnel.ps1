# ============================================================
#  Doumen smart-farm SSH reverse tunnel (keep-alive loop)
#  Home server (this PC) --> Aliyun ECS (relay)
#
#  Edit the four values below, then run this script (or use
#  tunnel-hidden.vbs / install-autostart.bat to run it hidden
#  and auto-start on login).
# ============================================================

$EcsIp     = "8.138.151.152"                      # Aliyun public IP
$EcsUser   = "root"                                # SSH user on the ECS
$KeyFile   = "C:\Users\Public\doumen\aliyun-doumen.pem"  # private key path
$RemotePort = 4173                                 # port bound on ECS 127.0.0.1
$LocalPort  = 4173                                 # vite preview port on this PC

Write-Host "[tunnel] target ${EcsUser}@${EcsIp}  ecs:127.0.0.1:${RemotePort} -> local:127.0.0.1:${LocalPort}"

while ($true) {
  & ssh -N `
      -o ExitOnForwardFailure=yes `
      -o ServerAliveInterval=30 `
      -o ServerAliveCountMax=3 `
      -o StrictHostKeyChecking=accept-new `
      -o ConnectTimeout=15 `
      -i "$KeyFile" `
      -R "127.0.0.1:${RemotePort}:127.0.0.1:${LocalPort}" `
      "${EcsUser}@${EcsIp}"
  $code = $LASTEXITCODE
  Write-Host "[tunnel] ssh exited (code $code), retrying in 5s..."
  Start-Sleep -Seconds 5
}
