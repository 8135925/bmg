# bmg

[保密观](https://www.baomi.org.cn)自动刷课与答题脚本的 **Web 版**：前端部署在 Vercel，接口通过**腾讯云函数**（大陆 IP）中转访问保密观 API。包含**一次性令牌**门禁与**管理后台**，无需本地 Python 环境。

> [!IMPORTANT]
> 本项目适用于 [2026年度全国保密教育线上培训](https://www.baomi.org.cn/bmCourseDetail/info?id=312bc914-8e11-421b-b9bc-e900fe1a4e50)。

## 架构

```
浏览器
  ├── Vercel（页面 + 令牌门禁 + 管理后台 + Blob 存储）
  │       └── /api/proxy
  └── 腾讯云函数 bmg-relay（上海，大陆 IP 出口）
          └── baomi.org.cn
```

> [!IMPORTANT]
> 保密观的 WAF 只放行中国大陆 IP。Vercel 的函数区域全部属于境外（含香港），直连会被拦截（405 / 连接超时），所以**必须**通过国内云函数中转。

## 功能

### 用户端（`/`）
- 一次性令牌门禁：进门一次令牌即焚，刷新/下次访问需要新令牌
- 扫码登录 / 账号密码登录（RSA 加密在浏览器端完成）
- 一键完成学习与考试 / 仅学习课程 / 仅完成考试
- 页面实时运行日志
- 不保存任何凭证：保密观 token 仅存在于页面内存

### 管理后台（`/admin.html`）
- 管理员密码门禁（配置在环境变量 `ADMIN_PASSWORD`）
- 批量生成 1-100 个一次性令牌（明文仅生成时展示一次）
- 令牌列表：未分配 / 已分配 / 已使用 / 已吊销 四种状态
- 标记分配（备注"给了谁"）、自动记录使用者保密观昵称、一键吊销
- 令牌明文不落库，存储中只有 SHA-256 哈希

## 部署步骤

1. 将本项目推送到 GitHub 仓库（或使用 [Vercel CLI](https://vercel.com/docs/cli) 直接部署）
2. 在 Vercel 导入该仓库创建项目
3. 按下方【配置管理员密码】设置 `ADMIN_PASSWORD`
4. 按下方【创建 Blob 存储】挂接 Blob
5. 按下方【部署中转云函数】在腾讯云创建中转函数，并回填 Vercel 的 `RELAY_URL` / `RELAY_KEY`
6. Redeploy 后验证

## 配置管理员密码

> [!IMPORTANT]
> 不配置 `ADMIN_PASSWORD` 管理后台将无法进入。旧版使用的 `ACCESS_PASSWORD` 已废弃。

1. 打开 [vercel.com](https://vercel.com) 并登录，进入 Dashboard，点击你的项目
2. 点击顶部 **Project Settings** → 左侧菜单选择 **Environments**
3. 点击环境列表中的 **Production**，进入详情页后添加变量：
   - 名称：`ADMIN_PASSWORD`（区分大小写，必须完全一致）
   - 值：你想设置的管理员密码（建议 8 位以上字母+数字组合）
   - 类型：选 **Secret**（保存后只写不可读）
4. **重新部署使其生效**：Deployments → 最新部署右侧 `⋯` → **Redeploy**（或推送新提交自动触发）

## 创建 Blob 存储（令牌存放在这里）

1. 项目主页点击顶部的 **Storage** 标签
2. 点击 **Create Database** → 选择 **Blob**
3. 命名（如 `bmg-blob`）→ **Access 选择 Public**（代码读取方式依赖公开 URL，文件中只有哈希，无敏感明文）→ **勾选 "Add a read-write token env var to this connection"**（关键，否则不会注入 `BLOB_READ_WRITE_TOKEN`）
4. 创建完成后 Vercel 会自动注入环境变量并触发重新部署

## 部署中转云函数（腾讯云 SCF）

> 前提：注册腾讯云账号并完成个人实名认证。云函数为后付费，新用户前 3 个月有免费额度，之后个人低频使用每月约几分钱。

1. 打开 [SCF 控制台](https://console.cloud.tencent.com/scf)，点击左上角 **新建**
2. 创建配置：
   - 创建方式：**从头开始**
   - **函数类型：Web 函数**（不是事件函数）
   - 函数名称：`bmg-relay`
   - 运行环境：**Node.js**（18 或 20）
   - 提交方法：**在线编辑**
3. 代码编辑器中删除示例内容，粘贴本项目 `relay/app.js` 的完整内容
4. 展开高级配置：
   - 内存：`128 MB`，执行超时时间：`30` 秒
   - 监听端口：`9000`
   - **环境变量**：Key `RELAY_KEY`，Value 自定义随机字符串（妥善保管，Vercel 侧要填同一个值）
   - **日志投递：取消勾选**（避免 CLS 日志服务收费）
5. 完成创建后，进入函数详情 → **函数 URL** → **启用公网访问** → 复制 HTTPS 地址
   - 启用后浏览器直接打开该地址应返回 `{"error":"unauthorized"}`，说明函数正常
   - 如提示 SSL 证书错误，是证书下发延迟，等几分钟到一小时再试
6. 回到 Vercel，在 Environments → **Production** 添加两个变量：
   - `RELAY_URL`：上一步复制的云函数 URL
   - `RELAY_KEY`：与云函数环境变量里**一模一样**的字符串
7. Redeploy，然后测试登录

> 提示：`RELAY_KEY` 不要提交到任何公开仓库，只存在于两处环境变量中。费用中心建议开启余额预警；不想用了在 SCF 控制台点「停用」即可立即停止服务。

## 使用流程

1. 访问 `https://你的域名/admin.html`，输入管理员密码进入控制台
2. 在"生成令牌"区输入数量 → 点击生成 → **立即复制明文令牌**（仅此一次展示）
3. 把令牌一对一私发给使用者（可在表格中"标记分配"并备注给了谁）
4. 使用者访问 `https://你的域名/`，输入令牌进入；令牌随即作废
5. 发现令牌外泄：在控制台吊销即可，其他未进入的人立刻被拒

## 课程 ID 更新（跨年度）

课程包 ID 存在于**官网课程详情页的网址**中，获取方法：

1. 电脑浏览器打开 [www.baomi.org.cn](https://www.baomi.org.cn) 并登录
2. 进入新年度培训课程的详情页（如"20XX年度全国保密教育线上培训"）
3. 查看地址栏，`?id=` 后面的一串即为课程包 ID：

```
https://www.baomi.org.cn/bmCourseDetail/info?id=312bc914-8e11-421b-b9bc-e900fe1a4e50
                                                    └────────── 课程包 ID ──────────┘
```

4. 将新 ID 更新到 `app.js` 顶部的 `CONFIG.COURSE_PACKET_ID`，推送后 Vercel 自动重新部署

> 考试 ID 无需更新：代码会优先通过接口动态获取当前课程关联的考试 ID，`DEFAULT_EXAM_ID` 仅作兜底。

## 本地开发

```powershell
npm install          # 安装 @vercel/blob 依赖
node dev-server.mjs
```

浏览器打开 `http://localhost:3000`（用户端）和 `http://localhost:3000/admin.html`（管理后台）。

**本地默认行为**（无需配置任何环境变量）：
- 管理员密码默认 `123456`
- 令牌存储自动降级为本地文件 `tokens.local.json`（已加入 .gitignore）
- 接口直连保密观（家庭宽带是大陆 IP，可正常访问，**无需中转**，勿配置 `RELAY_URL`）

**如需连接真实 Vercel Blob 测试**（可选）：

```powershell
$env:ADMIN_PASSWORD = "你的密码"; $env:BLOB_READ_WRITE_TOKEN = "从Vercel的Storage页面.env复制"
node dev-server.mjs
```

## 项目结构

```
├── index.html        # 用户端页面（令牌门禁 / 登录 / 主界面）
├── app.js            # 用户端业务逻辑（登录、学习、考试）
├── admin.html        # 管理后台页面
├── admin.js          # 管理后台逻辑
├── admin.css         # 管理后台样式
├── style.css         # 公共样式（苹果风格）
├── relay/
│   └── app.js        # 腾讯云函数中转服务代码（粘贴到 SCF 控制台使用）
├── api/
│   ├── auth.js       # 用户令牌校验（即焚）
│   ├── admin.js      # 管理接口（生成/分配/吊销，每次校验管理员密码）
│   ├── proxy.js      # Vercel 侧转发代理（配置 RELAY_URL 时转发给云函数）
│   └── storage.mjs   # 令牌存储层（线上 Vercel Blob / 本地文件自动切换）
├── dev-server.mjs    # 本地开发服务器
└── package.json
```

## 常见问题

**用户提示"管理员尚未生成任何令牌"**
先到 `/admin.html` 生成令牌；若已生成仍报此错，确认 Blob 已创建且部署成功。

**提示"管理员尚未配置 ADMIN_PASSWORD 环境变量"**
按【配置管理员密码】步骤配置后 Redeploy。

**提示"未检测到 BLOB_READ_WRITE_TOKEN"**
Blob 未创建或未关联到本项目，按【创建 Blob 存储】步骤操作后 Redeploy。

**登录报 405 / 连接超时 / 无法连接中转服务器**
依次检查：① Vercel 的 `RELAY_URL` 与云函数控制台显示的 URL 是否一字不差；② 云函数是否处于"运行中"且**公网函数 URL 已启用**（浏览器直接打开 URL 应返回 `{"error":"unauthorized"}`）；③ `RELAY_KEY` 两边是否一致；④ 云函数是否被欠费停服。

**云函数 URL 打开报 SSL 证书错误（ERR_SSL_VERSION_OR_CIPHER_MISMATCH）**
函数 URL 刚启用时证书下发有延迟，等几分钟到一小时自愈；期间可临时将 `RELAY_URL` 改为 `http://` 过渡。

**新账号提示"登录失败或 token 无效"**
请先在[官网](https://www.baomi.org.cn)网页端手动播放任意课程视频一次，再回来使用本工具。

## 免责声明

本项目仅供个人学习交流使用，请勿用于商业用途或公开传播。
