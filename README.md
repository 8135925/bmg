# bmg

[保密观](https://www.baomi.org.cn)自动刷课与答题脚本的 **Web 版**，纯前端实现（HTML/CSS/JS），部署到 Vercel。采用**一次性令牌**门禁 + **管理后台**，无需本地 Python 环境。

> [!IMPORTANT]
> 本项目适用于 [2026年度全国保密教育线上培训](https://www.baomi.org.cn/bmCourseDetail/info?id=312bc914-8e11-421b-b9bc-e900fe1a4e50)。

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
- 标记分配（可备注"给了谁"）、一键吊销、使用时间记录
- 令牌明文不落库，存储中只有 SHA-256 哈希

## 部署步骤

1. 将本项目推送到 GitHub 仓库（或使用 [Vercel CLI](https://vercel.com/docs/cli) 直接部署）。
2. 在 Vercel 导入该仓库创建项目。
3. 按下方【配置管理员密码】设置 `ADMIN_PASSWORD` 环境变量。
4. 按下方【创建 Blob 存储】为项目挂接 Blob。
5. 点击 `Deploy` 部署。

## 配置管理员密码（详细流程）

> [!IMPORTANT]
> 不配置 `ADMIN_PASSWORD` 管理后台将无法进入。旧版使用的 `ACCESS_PASSWORD` 已废弃。

1. 打开 [vercel.com](https://vercel.com) 并登录，进入 Dashboard，点击你的项目
2. 点击顶部 **Project Settings** → 左侧菜单选择 **Environments**
3. 点击环境列表中的 **Production**，进入详情页后添加变量：
   - 名称：`ADMIN_PASSWORD`（区分大小写，必须完全一致）
   - 值：你想设置的管理员密码（建议 8 位以上字母+数字组合）
   - 类型：选 **Secret**（保存后只写不可读）
4. 若需要预览/本地环境生效，再依次在 **Preview**、**Development** 环境中重复添加
5. **重新部署使其生效**：Deployments → 最新部署右侧 `⋯` → **Redeploy**（或推送新提交自动触发）

## 创建 Blob 存储（令牌存放在这里）

1. 项目主页点击顶部的 **Storage** 标签
2. 点击 **Create Database** → 选择 **Blob**
3. 命名（如 `bmg-blob`）→ 创建（免费 250MB，远超所需）
4. 创建完成后，Vercel 会**自动**为项目注入 `BLOB_READ_WRITE_TOKEN` 环境变量并重新部署，无需手动配置
5. 在 Storage 页面可以看到存储的 `tokens.json` 文件（内容只有哈希，没有明文令牌）

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
- 令牌存储自动降级为本地文件 `tokens.local.json`（已加入 .gitignore，不会提交）

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
├── api/
│   ├── auth.js       # 用户令牌校验（即焚）
│   ├── admin.js      # 管理接口（生成/分配/吊销，每次校验管理员密码）
│   └── proxy.js      # 接口转发代理（解决 CORS）
├── dev-server.mjs    # 本地开发服务器
├── vercel.json       # 函数区域固定为香港（hkg1）
└── package.json
```

## 常见问题

**用户提示"管理员尚未生成任何令牌"**
先到 `/admin.html` 生成令牌；若已生成仍报此错，确认 Blob 已创建且部署成功。

**提示"管理员尚未配置 ADMIN_PASSWORD 环境变量"**
按【配置管理员密码】步骤配置后 Redeploy。

**接口请求 405**
目标站 WAF 会拦截境外 IP。`vercel.json` 中 `regions: ["hkg1"]` 已将函数固定在香港执行；若仍 405，说明目标站封锁了全部境外机房 IP，只能改用国内云函数中转或本地运行。

**新账号提示"登录失败或 token 无效"**
请先在[官网](https://www.baomi.org.cn)网页端手动播放任意课程视频一次，再回来使用本工具。

## 免责声明

本项目仅供个人学习交流使用，请勿用于商业用途或公开传播。
