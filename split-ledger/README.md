# 五人账本 (Split Ledger)

五个人共用的 AA 分账工具：记账、勾选参与人、平分或按金额分摊、计算每人净余额，并给出**最少转账次数**的结清方案。

网页 + API 是同一个 Node.js 服务，数据存为 JSON 文件（放在持久卷上）。

## 部署到 Railway

1. Railway → **New Project → Deploy from GitHub repo** → 选择本仓库
2. 服务的 **Settings → Source**：
   - **Branch**: 部署所用分支
   - **Root Directory**: `split-ledger`
3. 给服务 **添加一个 Volume**（挂载路径随意，比如 `/data`）——没有卷的话每次重新部署数据会清空
4. **Settings → Networking → Generate Domain**，得到公开网址

服务自动读取 `RAILWAY_VOLUME_MOUNT_PATH`，无需额外环境变量。

## 本地运行

```bash
cd split-ledger
npm install
npm start   # http://localhost:3000
```

## API

- `GET /api/state?v=<version>` — 全量数据，版本没变则返回 304
- `POST /api/expenses` — 新增账单 `{desc, amount(分), payer, parts[], mode, shares?}`
- `PUT /api/expenses/:id` — 修改未结清的账单
- `DELETE /api/expenses/:id` — 删除未结清的账单
- `POST /api/settle` — 把当前所有未结清账单归档为一个结清批次

注意：无登录鉴权，拿到链接的人即可读写，请只在朋友群里分享链接。
