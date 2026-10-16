# bmg

[保密观](https://www.baomi.org.cn)自动刷课与答题脚本的 **Web 版**，纯前端实现（HTML/CSS/JS），部署到 Vercel，无需本地 Python 环境。

> [!IMPORTANT]
> 本项目适用于 [2026年度全国保密教育线上培训](https://www.baomi.org.cn/bmCourseDetail/info?id=312bc914-8e11-421b-b9bc-e900fe1a4e50)。

## 功能

- 访问密码门禁：密码配置在 Vercel 环境变量中，后台修改后旧密码立即失效
- 扫码登录 / 账号密码登录（RSA 加密在浏览器端完成）
- 一键完成学习与考试 / 仅学习课程 / 仅完成考试
- 页面实时运行日志
- 不保存任何凭证：token 仅存在于页面内存，刷新即失效

## 部署步骤

1. 将本项目推送到 GitHub 仓库（或使用 [Vercel CLI](https://vercel.com/docs/cli) 直接部署）。

2. 在 Vercel 导入该仓库创建项目。

3. **配置访问密码**（必须）：
   - 进入 Vercel 项目 → `Settings` → `Environment Variables`
   - 新增变量：名称 `ACCESS_PASSWORD`，值为你想要的访问密码
   - Environment 建议同时勾选 `Production`、`Preview`、`Development`

4. 点击 `Deploy` 部署。访问分配的域名（如 `xxx.vercel.app`），输入访问密码即可使用。

## 修改访问密码

进入 Vercel 项目 → `Settings` → `Environment Variables` → 修改 `ACCESS_PASSWORD` 的值 → **Redeploy** 使其生效。

生效后：
- 尚未进入的用户：输入旧密码会被拒绝，必须输入新密码
- 已经进入的用户（当前页面会话）：不受影响，下次打开页面时需输入新密码

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

```bash
npm i -g vercel
vercel login
vercel dev
```

在弹出的项目关联流程中，同样需要为 `Development` 环境配置 `ACCESS_PASSWORD`。浏览器打开 `http://localhost:3000` 即可调试。

## 项目结构

```
├── index.html        # 页面（门禁 / 登录 / 主界面）
├── app.js            # 业务逻辑（登录、学习、考试）
├── style.css         # 样式
├── api/
│   ├── auth.js       # 访问密码校验（读环境变量）
│   └── proxy.js      # 接口转发代理（解决 CORS）
├── vercel.json       # Vercel 函数运行时配置
└── package.json
```

## 常见问题

**提示"管理员尚未配置 ACCESS_PASSWORD 环境变量"**
未设置环境变量或未重新部署，按上述步骤配置后 Redeploy。

**新账号提示"登录失败或 token 无效"**
请先在[官网](https://www.baomi.org.cn)网页端手动播放任意课程视频一次，再回来使用本工具。

**扫码超时**
二维码有效期约 300 秒，超时后点击"刷新二维码"重新获取。

## 免责声明

本项目仅供个人学习交流使用，请勿用于商业用途或公开传播。
