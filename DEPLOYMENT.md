# Azure 部署与认证

## 当前资源

- 站点：https://web-lights-camera-action-46df95.azurewebsites.net/
- 订阅：`46df95d3-489a-4529-8bc6-541b5fbc9bf5`。
- 资源组：`rg-qwen-studio-sea`，区域 Southeast Asia。
- 独立计划：`asp-lights-camera-action-f1`，已核验 SKU `F1`、tier `Free`。
- Web App：`web-lights-camera-action-46df95`，Linux Python 3.12、HTTPS only。
- 没有修改已有 Qwen 应用、B2 计划、存储和网络。
- Entra 租户：`b01a4337-0efd-4d51-be25-76f96f2c13c4`。
- Client ID：`2a74acf8-dc22-4467-816e-3a57aaff0e7c`。
- 应用对象 ID：`38622452-6811-4318-ae4a-2b3b06352445`。
- 企业应用对象 ID：`ffefdec9-d547-4b08-be03-cc8a4dc5cce8`。
- 初始 Entra 管理员：部署用户 Yong Ma，`ba3569ae-3c25-434b-8334-91fa24195212`。
- 首次客户端凭据到期：**2027-03-27 05:28 UTC**；密钥仅存于 Azure 应用设置。

## 认证边界

参考 [alex-mobile-codex-app](https://github.com/mayong43111/alex-mobile-codex-app) 的混合认证，使用官方 MSAL Python、Flask-Login、Flask-Session、Argon2id、Flask-Limiter。

Entra 使用授权码与 PKCE S256，MSAL 校验 state/nonce，应用再校验 tenant、issuer、audience、到期时间。回调为 `/auth/callback`，流程十分钟有效，用后移除。单租户、无需企业应用单独分配，允许租户成员和来宾；仍受租户许可与条件访问策略限制。未使用 ROPC、隐式授权或客户端平台身份头。

密码账户无公开注册，由 `ENTRA_ADMIN_USER_IDS` 指定的 Entra 管理员在 `/account` 创建或明确重置。用户名 3–64 字符，密码 12–256 字符，Argon2id 哈希存储。重置密码撤销旧会话。Entra 与密码身份不按同名或邮箱自动合并，也不会将所有租户用户设为管理员。

服务端会话通过 Flask-Session 保存。Cookie 为 `__Host-studio-session`、Secure、HttpOnly、SameSite=Lax；登录轮换、退出删除、固定十二小时失效。写请求校验精确 Origin 与每会话 CSRF。登录表单使用 `Referrer-Policy: same-origin`，防止浏览器将 POST Origin 置为 null；回调保持 `no-referrer`。密码登录全实例每十五分钟八次，限速内存状态重启会清零，适合低频试用。

匿名仅可访问登录页面、认证状态、授权入口/回调、登录样式和健康检查，业务 API 返回 401。不启用 Easy Auth，也不信任 `X-MS-CLIENT-PRINCIPAL`。旧页面身份标记与当前会话不符时拒绝请求，避免跨账号写入。

## 数据与免费层

`/home/studio/auth.sqlite3` 保存用户；`/home/studio/sessions` 保存会话；`/home/studio/users/<身份SHA256>/studio.sqlite3` 保存各用户图片、配置和个人组合。使用默认 DELETE journal，单 Gunicorn 进程四线程，不支持直接横向扩容；扩容前需更换共享会话、限速和数据存储。拥有 Azure 运维权限的人仍可读取磁盘数据。

旧本地数据库不随部署上传或自动迁移。浏览器自存姿势仍使用按身份区分的 localStorage，不跨设备同步，也不是加密存储；共用浏览器配置文件时应谨慎，重要姿势单独导出。内置二十组组合共享只读。

F1 有 CPU、内存、磁盘配额及空闲休眠限制，不支持 Always On，没有生产 SLA。参见 [App Service 计划](https://learn.microsoft.com/azure/app-service/overview-hosting-plans) 和 [服务限制](https://learn.microsoft.com/azure/azure-resource-manager/management/azure-subscription-service-limits#azure-app-service-limits)。免费托管不包含 Azure AI 模型费用。大图可能占满磁盘，长 AI 请求可能遭遇平台前端超时，不得因此自动重试付费请求。

未配置自动备份。维护窗口停止站点后，通过受控运维渠道备份整个 `/home/studio`，恢复时保持用户数据库与对应目录一致；不要将数据库放入部署包或公开下载。

## 维护

Azure 应用设置：`ENTRA_TENANT_ID`、`ENTRA_CLIENT_ID`、`ENTRA_CLIENT_SECRET`、`ENTRA_ADMIN_USER_IDS`、`STUDIO_SECRET_KEY`、`STUDIO_DATA=/home/studio` 和原有 Azure OpenAI 配置。平台自动提供 `WEBSITE_HOSTNAME`。客户端凭据到期前在本项目 Entra 应用添加新密钥，通过 Azure 安全界面更新设置，验证后撤销旧密钥。不得将密钥发到聊天或提交到 Git。

重复部署前运行测试，再执行：

```powershell
npm ci
npx playwright install chromium
npm run build
npm test
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_server.py
.\.venv\Scripts\python.exe scripts/deploy_azure.py --subscription 46df95d3-489a-4529-8bc6-541b5fbc9bf5 --group rg-qwen-studio-sea --app web-lights-camera-action-46df95 --tenant b01a4337-0efd-4d51-be25-76f96f2c13c4 --client 2a74acf8-dc22-4467-816e-3a57aaff0e7c --application-object 38622452-6811-4318-ae4a-2b3b06352445 --admin ba3569ae-3c25-434b-8334-91fa24195212
```

打包需要本机 Node.js 22.12+，脚本先执行 `npm run build`，失败即停止；生产服务器只需要 Python。可用 `--package-only` 仅验证本地打包而不连接 Azure。包中包含 `dist/index.html`、`dist/static`、模型数据、认证模板和 Python 运行文件，不包含 `node_modules`、TypeScript 源码或开发服务器。

脚本拒绝非免费计划，核对应用与回调。部署包位于 Git 忽略的 `.studio-data/deploy/studio.zip`，仅含运行文件；不包含 `.env`、数据库、测试账号或测试图片。原有六个 OpenAI 设置从本地 `.env` 读入进程后直接传给 Azure，不输出密钥。已有登录密钥复用，不自动轮换。本次 React 迁移尚未部署，下面的线上验收记录对应迁移前版本。

生产命令：`gunicorn --bind 0.0.0.0:8000 --workers 1 --threads 4 --timeout 300 server:app`。Oryx 安装运行依赖；Windows ARM64 本地安装若遇到 OpenSSL 编译失败，更新 pip 后使用 `pip install --only-binary=:all: -r requirements.txt`。

## 验证范围

2026-09-28 部署返回 `RuntimeSuccessful`。真实站点健康检查 200、匿名 API 401、伪造身份头 401；Entra 跳转的客户端、回调、授权码、S256 正确，Cookie 安全标志正确。按要求移除了登录预览横幅，线上桌面/手机检查均通过。

本地 33 项后端、39 项前端测试通过；真实 MSAL 配合明确的离线身份服务器夹具覆盖 state/nonce/租户与重放拒绝。隔离浏览器中完成桌面与手机密码登录、应用组合、3D 非空、退出后 API 401。

真实 Entra 用户最终登录/MFA/租户许可、线上创建账户后的完整密码登录及实际模型调用仍需用户使用验证。本次验收未调用收费 AI，也未创建生产测试密码账户。