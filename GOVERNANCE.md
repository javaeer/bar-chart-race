# 治理（Governance）

## 项目状态

个人维护的开源工具，当前由 **@javaeer** 作为唯一维护者（BDFL 模式）。

## 角色

| 角色 | 成员 | 权责 |
|---|---|---|
| 维护者（Maintainer） | @javaeer | 合并权、发版权、安全管理权 |
| 贡献者（Contributor） | 任何提交被合并者 | 参与讨论、提交 PR |

## 决策流程

- **日常改动**：维护者直接合并，或经 PR review 后合并
- **重大方向**（API 变更 / 新导出格式 / 许可证变更）：在 Issue 中公开讨论，维护者拍板
- **安全事件**：通过 GitHub Security Advisories 私有通道处理（见 `SECURITY.md`）

## Bus Factor

当前 bus factor = 1。为降低单点风险：

- 所有流程与工作流均文档化（`CONTRIBUTING.md` 与 `docs/`）
- 关键目录审查责任见 `.github/CODEOWNERS`
- CI / 安全扫描 / 发布全部自动化，不依赖个人本地环境

## 发布策略

- 语义化版本（SemVer）；breaking change 升主版本
- 打 `v*` tag 触发 Release 工作流，自动附单文件 Demo 作为 Release Asset
- `CHANGELOG.md` 手工维护，Release Notes 由其提取

## 赞助

赞助 / 资金支持：见 `.github/FUNDING.yml`（如启用）。
