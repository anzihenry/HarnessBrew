---
title: 变更记录
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 变更记录

[English](CHANGELOG.en.md)

版本摘要保留历史语境，不代表当前支持或正式发布。1.x 候选与发布状态见[版本索引](docs/releases/README.md)。

## 未发布

- 采用全生命周期文档规范，迁移为中文主文件和英文配对，整理当前指南/契约/专题/版本证据，接入结构和独立评审检查。

## 1.3.0 - 2026-10-08

### 新增

- 预览并显式应用保守缓存/revision 保留策略，使用日志删除并支持恢复中断维护
- 保护活跃准备租约、有效计划、注册插件、catalog 快照、CURRENT 和用户隔离证据
- 支持 SDK 取消、期限、隔离进度回调和 close 排空；CLI 进度写 stderr，信号安全收尾
- 返回类型化 effects 和明确提交/维护结果

### 调整

- 保存计划 30 天后过期，必须显式重新生成
- 持久提交前取消回滚，提交后保留结果，恢复不受取消中断
- 普通计划 v2、升级 v3、Home/Journal/Bundle v1 保持；内置签名改变须显式升级

### 修复

- 在验证维护预览和计划保护前解析 Home 父目录别名

### 限制

- 保留预算仅作报告；未知对象、引用历史、跨缓存引用和 bare Git 可能保留
- revisions 不是完整回退备份，Home、目标和 Bundle lock 须一致保存
- 候选验证和真实 runtime 证据与正式发布分别记录

## 1.2.0 - 2026-10-07

### 新增

- 不 import 代码地检查 Adapter 候选，报告签名覆盖和受影响安装/Bundle
- 通过 SDK/CLI 预览显式授权候选摘要和能力
- 同事务升级注册、目标和所有受影响 Bundle lock，资产 pins 不变
- 保留其他 Adapter 操作，支持显式升级回保留的第三方旧包

### 调整

- 内置签名从 emitted runtime 闭包和生产依赖锁生成，已有注册须显式升级
- 升级预览 v3，普通 v2，Home/Journal/Bundle/CLI v1 保持
- 提交前验证所有 checkout 和 lock 字节，外部冲突保留恢复证据

### 验证

- 覆盖手动/多 Bundle 升级、能力变化、输入漂移、真实 SIGKILL 和一致备份回退
- release gate 包含打包 Adapter 身份/升级检查，最终跨平台及真实 runtime 证据单独记录

## 1.1.0 - 2026-10-06

### 调整

- Git、插件和内容准备在事务写锁外进行，提交前完整复验
- 应用用例拆分为内部可注入端口，检查架构导入边界
- 严格校验 saved-plan v2，v1 重新生成，Home/Journal/CLI result v1 保持
- 进程租约和持久引用保护准备/保存预览缓存，包括历史根
- 拒绝过期并发工作而不自动重规划，保留 Journal 提交/恢复语义

### 验证

- 增加多进程竞争、崩溃、输入漂移和准备内容完整性覆盖
- 记录六组来源规模基准及更短事务锁持有，候选验收单独记录

### 内容生命周期（纳入开发基线）

- 内容以摘要独立登记，保留升级历史供核验回收
- 从精确可信 commit 修复缺失内容，修改原件须 --restore-content 隔离
- CLI/SDK 与 Doctor 分组提供内容变化、共享引用和隔离路径
- 新 Home 必须有内容库存和隔离字段，旧实验 Home 不迁移

## 1.0.0 - 2026-10-02

### 破坏性变更

- 旧 SDK 替换为 createHarness、类型请求和 HarnessError；harnessbrew/adapter 导出插件类型
- Home、来源、资产、Manifest、lock、plan、插件要求版本化格式，旧数据拒绝而不自动删除/迁移
- 旧 CLI 别名移除，采用 remove、repair、bundle apply/detach 和显式来源信任
- Receipt/Cellar 改为不可变内容、usage requirements、资源所有权和 CURRENT 原子快照

### 新增

- 手动安装、升级、placement 和独立 Bundle 共用依赖解析/规划
- 只读预览、宿主保存计划、严格漂移检查和精确可移植 Bundle lock
- 日志执行/元数据、崩溃恢复、跨 Home 锁和核验孤立内容回收
- Doctor 分组诊断、缺失目标修复、共享资源范围覆盖和签名链接插件授权
- 版本化 CLI JSON 和独立 macOS/Linux/已认证 runtime 发布证据

### 移除

- 删除无用旧后端和专用夹具，剩余测试覆盖当前架构或发布工具

## 0.8.0 - 2026-09-17

### 新增

- 一次 dispatch 编排候选构建、跨平台、真实 runtime、保护审批和精确字节发布
- 验证完整新鲜证据与六个校验附件，安全继续相同 npm 发布而不覆盖 tag/资产

### 修复

- import 前拒绝无完整性基线的 Adapter，要求显式审查并移除/重新注册
- 记录/CLI 标注 Adapter 仅验证入口文件，不声称覆盖导入和依赖
- JSON 模式的文件系统/未知 CLI 异常使用版本化错误 envelope
- 所有依赖和项目安装使用公共 npm registry，避免 npm12 EALLOWREMOTE

### 调整

- 内置 Target/runtime 只保留 OpenAI Codex，移除 Claude Code Adapter/探针
- 覆盖 Codex 全部 12 种 Formula/scope 投放，每项 runtime 必须通过
- 编译前清空生成目录，删除模块不进入发布包

当时已有 receipts 可按所有权清理；已移除 Target 需兼容 Adapter 才能链接/重投放/升级。

## 0.7.1 - 2026-09-07

### 新增

- 验证 Node22/npm11 和 Node24/npm12 源码兼容
- 信任 Adapter 时记录入口 SHA-256，执行前核验

### 调整

- 固定 npm11.17.0 用于候选和跨平台 gate
- 当前文档描述已实现 Tap/Formula 架构

### 修复

- 兼容 npm pack --json 的 npm11 数组和 npm12 按键对象输出
- 并发产物锁处理释放及遗留锁竞争

## 0.7.0 - 2026-08-13

### 新增

- 单次 npm tarball 生成不可变 manifest 和 SHA-256
- 隔离打包 CLI E2E 覆盖 Tap/Formula 全生命周期、24 种内置投放、升级、doctor/relink、Bundle、cleanup、JSON 和预览回滚
- 添加 Linux/macOS 共用的无凭据 deterministic release:gate
- 添加已认证 Codex/Claude Skill、Instruction、Agent、MCP 本地 release:preflight
- 添加脱敏 runtime 证据：候选身份、CLI 版本、失败分类、时序和有限事件元数据
- 添加候选、受保护 npm 发布和发布后 registry smoke 工作流
- 添加发布验证操作指南

### 调整

- package smoke/E2E 必须提供候选，不隐式重新打包
- CI 单次构建并在 Linux/macOS 验证相同 SHA-256，不使用模型凭据
- npm 发布按 workflow run ID 下载已批准候选，核对 commit/tag/version/digest 后带 provenance 发布同包

### 修复

- Bundle cleanup 按依赖者先于依赖顺序删除
- 多个 Target 写共享新父目录时保持事务指纹更新
- 串行产物构建，避免 npm pack 与 prepack 输出改写竞争

## 0.6.2 - 2026-08-13

### 安全

- README/架构示例个人标识替换为中性 your-name

## 0.6.1 - 2026-08-13

### 调整

- CI/发布升级 checkout@v6 和 setup-node@v6，构建仍使用 Node22
- 包元数据、CI、安装一致要求 Node22+
- 当时以英文为 README/架构主语言，并保留完整简体中文
- 历史发布说明移入 docs/releases，删除过时路线图、任务和旧 walkthrough
- 两版 README 添加 CI、npm、Node 和许可证徽标

## 0.6.0 - 2026-08-13

### 新增

- 版本化 JSON CLI envelope，提供命令结果和结构化错误
- 事务 dry-run 报告路径指纹并回滚受管变更
- Target Adapter API v1：验证注册、Cellar 限定链接、事务执行和 lock 版本指纹
- CLI 显式管理可信 Adapter 模块，持久身份校验和事务预览

### 安全

- 破坏操作前验证 Receipt、Cellar 规范位置、操作元数据、归属键和路径
- 库存精确检测新增/删除/修改/不支持/权限变化文件
- 防止强制 cleanup 递归删除替换受管链接的真实目录
- 每 Home CLI 变更串行，跨进程保护共享 Target 配置
- 持久 write-ahead Journal 恢复中断操作、死亡锁和外部 Target 文件
- Harnessfile/lockfile v2：结构 scope、可移植路径、内容摘要、显式 lock 刷新和 Target 收敛
- Target 激活前要求 Tap 信任，默认快进更新，非法候选回滚

## 0.5.2 - 2026-08-13

### 修复

- 自动发布传显式本地 tarball 路径，不被 npm 当作 Git 依赖
- 发布测试保护 npm pack→npm publish 的精确产物交接

## 0.5.1 - 2026-08-13

### 修复

- 发布 tarball 包元数据保留 harnessbrew 可执行映射
- package smoke 在干净 CI 运行，不要求预热离线缓存
- 自动发布检出/验证精确 tag，构建一次并带 provenance 发布同包
- 自动校验包、源码、CHANGELOG、Git tag 版本一致

## 0.5.0 - 2026-08-13

### 新增

- Codex/Claude 采用显式能力矩阵与纯安装规划
- Receipt schema v2 支持事务 symlink-directory/file、render-file、managed-block、merge-config
- 原生 Agent、Workflow/Prompt 转 Skill、托管 Instruction 和键归属 MCP 合并
- user/project scope，同一 Formula 在同 Target 多位置投放
- doctor 完整性诊断和 relink 修复
- 每种 Formula/Target/scope 的 E2E 覆盖

### 调整

- Skill 链接完整目录，保留脚本、引用和相对资源
- Target 身份由 Target+目的地确定，不只名称
- 升级重建全部已记录 Target 投放并保留无关配置
- MCP 使用可移植 JSON，凭据仅引用环境变量名

### 修复

- 共享 AGENTS.md、Codex TOML、Claude JSON 在链接/升级/移除/回滚保留用户内容
- 破坏操作前检测修改/缺失的文件、链接、区块和键
- Adapter Formula 链接明确失败，不猜测 kind 目录

## 0.4.0 - 2026-08-12

### 新增

- Git Tap 注册、校验、更新、commit checkout 和移除
- Formula catalog 覆盖 skills、agents、workflows、instructions、prompts、MCP 和 adapters
- 依赖解析、冲突、不可变 Cellar 安装和 SHA-256 receipts
- Codex/Claude Target 链接带所有权和篡改检查
- update、outdated 与可回滚 upgrade
- Git 可复现 Harnessfile/Harnessfile.lock、bundle install/cleanup
- TypeScript7 strict、测试、npm 打包和 GitHub 发布自动化

### 调整

- 重新定义为 Git-native AI Agent 资产管理器
- 版本历史从单资产快照改为 Tap commits/tags
- 最低 Node 版本提升为20

### 移除

- 移除仓库样例资产与旧 workspace/export 架构

## 0.3.0 - 2026-06-27

### 新增

- 资产维护 set、add/remove-dependency、clone、archive
- 依赖图 deps、dependents、orphans、impact
- bundle checksums.json 与 manifest 摘要验证产物
- verify-bundle 校验文件、SHA-256 和 payload 一致
- pack --channel draft/stable，stable 要求 workspace 验证
- pack --archive 生成 tar.gz
- 添加资产创建至 bundle 验证 walkthrough（现已移除）
- 添加0.3.0版本触点、检查和发布流程文档（现已合并）

### 调整

- 样例 agent 依赖与初始化 workspace 一致
- 资产 status active/archived 与 list --status
- README 展示0.3.0生命周期/依赖图/bundle验证
- smoke 覆盖生命周期、图、摘要、验证、channel 和归档

### 修复

- archive 拒绝仍被依赖的资产
- bundle 验证检测缺文件、摘要错误及 manifest/assets 集合漂移

## 0.2.0 - 2026-06-17

### 新增

- 资产依赖检测缺失、重复、循环和 Target 不兼容
- show --resolved 展示依赖树和扁平图
- list 支持 kind/tag/owner/target/group-by
- list/validate/history/diff/export/pack 支持 JSON
- export --entry 与 include-dependencies
- pack 交付 manifest.json、assets.json 和 rendered/target.json
- workspace schemaVersion 与 bundleDirectory
- 0.2.0里程碑、命令与打包方向路线图

### 调整

- export/pack 强化 Target 兼容
- smoke 增加依赖、Adapter、scope export 和 bundle
- README/架构更新为0.2.0模型

## 0.1.1 - 2026-06-17

### 新增

- harness --version 查看版本
- 发布文档提供版本可见性和预发布验证

### 调整

- workspace 更严格检查 timezone、历史、Target 重复和快照一致
- 更清晰的 diff 元数据字段摘要
- history 显示当前版本和快照路径
- show 支持 metadata/content 模式
