# TenSeat

TenSeat 是一个多餐馆预约系统，套餐价格为 A$10/月。Stripe 真实扣款暂时没有接入。

## 本地启动

```powershell
npm start
```

- Chirin 客人预约：`http://127.0.0.1:8795/r/chirin`
- 餐馆登录与注册：`http://127.0.0.1:8795/owner`

## Chirin 初始账号

- 邮箱：`chirin.food191@gmail.com`
- 临时密码：`Chirin1919!`

登录后后台会提示修改默认密码。正式上线前必须把临时密码换成只有餐馆知道的新密码。

## 已完成的功能

- 每家餐馆独立注册、登录和预约链接
- 客人选择日期、姓名、人数和 11:30-14:30 的 24 小时制预约时间
- 单次预约人数上限可配置，Chirin 当前为 20 人
- 预约成功后显示预订编号，并提醒客人复制保存
- 客人用预订编号取消预约
- 餐馆端查看预约、客人人数、取消记录和预订编号
- 餐馆端修改餐馆名称、地址、Google Maps 搜索内容、营业时间和人数上限
- 密码加盐哈希保存
- 登录/注册/预约/取消接口已加入基础防刷限制
- 服务启动时自动备份 `data/restaurants.json` 和 `data/bookings.json`
- 支持云服务器环境变量：`HOST`、`PORT`、`PUBLIC_ORIGIN`、`SESSION_SECRET`、`TRUST_PROXY`、`DATA_DIR`

## 上线前仍需注意

- Stripe 扣款尚未连接，A$10/月目前只是页面和账号状态显示。
- 当前数据仍保存在 JSON 文件中，适合 MVP 和早期小流量测试；正式多客户版本建议迁移到 Postgres/Supabase。
- 需要在云平台设置 HTTPS 域名，并把 `PUBLIC_ORIGIN` 设置成真实域名。
- 需要准备 Privacy Policy、Terms、退款/取消订阅说明。

## 部署配置

项目包含：

- `.env.example`：环境变量模板
- `render.yaml`：Render Web Service 部署模板
- `.gitignore`：避免上传本地密钥、备份和依赖目录

生产环境建议：

```text
NODE_ENV=production
HOST=0.0.0.0
PUBLIC_ORIGIN=https://your-domain.com
SESSION_SECRET=一串至少32位的随机密钥
TRUST_PROXY=true
DATA_DIR=/var/data/tenseat
```

## Render 上线步骤

1. 把这个项目上传到 GitHub。
2. 在 Render 创建 Web Service，连接这个 GitHub 项目。
3. 如果 Render 识别到 `render.yaml`，按 Blueprint 创建服务。
4. 在 Render 环境变量里把 `PUBLIC_ORIGIN` 改成你的正式网址，例如 `https://tenseat.example.com`。
5. 确认服务带有持久硬盘，挂载路径是 `/var/data/tenseat`。
6. 部署完成后打开 `/r/chirin` 测试客人预约，打开 `/owner` 测试餐馆后台。
7. 给餐馆修改默认密码，再把餐馆链接放到 Google Business Profile。
