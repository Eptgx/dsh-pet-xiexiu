# git push 报 HTTP 502 的排查记录

> 记录时间：2026-10-24
> 涉及仓库：https://github.com/Eptgx/dsh-pet-xiexiu

## 现象

`git push` 失败，常见三种输出：

```text
fatal: unable to access 'https://github.com/<user>/<repo>.git/':
The requested URL returned error: 502
```

```text
error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502
send-pack: unexpected disconnect while reading sideband packet
fatal: the remote end hung up unexpectedly
```

有时对象已经传完才失败：

```text
Writing objects: 100% (187/187), 2.31 MiB | 22.98 MiB/s, done.
fatal: the remote end hung up unexpectedly
```

## 根因

本机装了 **steamcommunity_302（S302）GitHub 加速器**，它会：

1. 修改 `C:\Windows\System32\drivers\etc\hosts`，把 `github.com`、`api.github.com`、
   `raw.githubusercontent.com` 等域名指向 `127.0.0.1`；
2. 自己监听 `127.0.0.1:443` 做转发。

它对 **GET 请求**（浏览、拉取、`ls-remote`）正常，但 **`git push` 的 POST `/git-receive-pack`**
会被它转发坏，于是返回 502。所以表现为：

- 克隆、拉取、打开网页都正常；
- 一推送就 502，有时传完对象才断；
- 换 token、换账号、改 `http.version` 都没用。

## 一分钟判断

管理员 PowerShell 里执行：

```powershell
# 1. 看域名解析：返回 127.0.0.1 就是被加速器接管了
Resolve-DnsName github.com -Type A

# 2. 看 hosts 里的 S302 标记
Select-String C:\Windows\System32\drivers\etc\hosts -Pattern 'github'

# 3. 看谁在监听 443
Get-NetTCPConnection -LocalPort 443 -State Listen

# 4. 直接测 POST（把 <user>/<repo> 换成你的）
curl.exe -sS -o NUL -w "HTTP %{http_code}\n" -X POST `
  "https://github.com/<user>/<repo>.git/git-receive-pack"
```

判断标准：

| 返回码 | 含义 |
|---|---|
| **502** | 链路/加速器问题，就是本文这种情况 |
| 401 | 链路正常，只是没带凭据（正常） |
| 403 | 凭据有效，但 token 没权限 |
| 200 | 意外，通常是测错了地址 |

## 解决 A：临时退出加速器（最简单）

1. 在托盘找到 **steamcommunity_302**，右键退出；
2. 重新执行 `git push`。

如果退出后 `Resolve-DnsName github.com` 仍返回 `127.0.0.1`，说明 hosts 里的记录没被清掉，
用下面的解决 B 还原；或者重启一次网络/电脑。

## 解决 B：临时改 hosts，绕过加速器

需要**管理员** PowerShell。

```powershell
$h = 'C:\Windows\System32\drivers\etc\hosts'

# 1. 先备份
Copy-Item $h "$h.bak" -Force

# 2. 把 github.com 指向真实 IP
$c = Get-Content $h
$c = $c | ForEach-Object {
  if ($_ -match '^\s*127\.0\.0\.1\s+github\.com(\s|$)') {
    '20.205.243.166 github.com #temp-for-push'
  } else { $_ }
}
Set-Content $h $c -Encoding Ascii
ipconfig /flushdns

# 3. 验证：返回 401 就说明链路正常
curl.exe -sS -o NUL -w "HTTP %{http_code}\n" -X POST `
  "https://github.com/<user>/<repo>.git/git-receive-pack"

# 4. 推送
cd D:\dsh-pet-xiexiu
git push -u origin main
```

推送成功后**立刻还原**，否则浏览器访问 GitHub 会走直连，可能变慢：

```powershell
$h = 'C:\Windows\System32\drivers\etc\hosts'
Copy-Item "$h.bak" $h -Force
ipconfig /flushdns
```

> 可用 IP：`20.205.243.166`、`140.82.112.3`、`140.82.113.3`、`140.82.114.3`
> 任何一个 `curl` 返回 401 都能用。

## 解决 C：改用 SSH over 443（长期方案）

`ssh.github.com` 不在 hosts 里，不受加速器影响：

```powershell
# 1. 生成密钥（已存在可跳过）
ssh-keygen -t ed25519 -C "Eptgx"

# 2. 把 ~/.ssh/id_ed25519.pub 的内容加到
#    GitHub → Settings → SSH and GPG keys → New SSH key

# 3. ~/.ssh/config 写入
# Host github.com
#   HostName ssh.github.com
#   Port 443
#   User git

# 4. 换远程地址并推送
git remote set-url origin git@github.com:Eptgx/dsh-pet-xiexiu.git
git push -u origin main
```

## 不要做的事

- **不要** `git config http.sslVerify false`：这不是证书问题，关掉校验也解决不了 502；
- **不要**反复换 token：502 发生在认证之前/之后都可能，和 token 权限无关；
- **不要**把 `http.sslBackend=schannel` 当成解法：它解决的是另一个问题——
  git 自带 OpenSSL 证书链在本机报 `SSL peer certificate ... not OK`，与 502 无关；
- 不要把 502 和 401/403 混为一谈（见上面的对照表）。

## 本次实际过程（备查）

1. 首次 `git push` 报 SSL 证书错误 → 设置 `http.sslBackend=schannel` 后解决；
2. 之后推送报 502，一度误以为是 token 权限（实际 403 才是权限问题）；
3. 用管理员 PowerShell 把 `github.com` 临时指向 `20.205.243.166`；
4. `git push -u origin main` 成功，提交 `c908aa2`，141 个文件；
5. 已还原 hosts，`Resolve-DnsName github.com` 回到 `127.0.0.1`。

**结论：看到 502 先查 `Resolve-DnsName github.com` 是不是 127.0.0.1，是的话就是加速器的锅。**
