---
title: A 批次来源规模基准
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# A 批次来源规模基准

[English](benchmark.en.md)

测量日期 2026-10-06，干净结果源码 aa9b5fd55fea5c7f08239b6390abdf6e430bc436，Apple M1 Max/macOS arm64、Node 24.19.0。原始[基线](evidence/batch-a-baseline.json)和[结果](evidence/batch-a-after.json)逐字保留，基线 dirty 标记表示未提交的测量挂点，不冒充干净发布源码。

工作负载为准备/信任本地 tap、查询 catalog、安装一个资产；fixture 构造不计入。规模为 10/100/1000 资产 × 256/65536 字节。下表为完整工作负载累计毫秒，四舍五入。

| Assets | Payload bytes/asset | Total before → after | Home hold before → after | External hold before → after |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 256 | 1194 → 882 | 1134 → 230 | 1079 → 205 |
| 10 | 65536 | 1018 → 882 | 966 → 224 | 920 → 203 |
| 100 | 256 | 4310 → 3420 | 4221 → 282 | 4189 → 262 |
| 100 | 65536 | 5098 → 3477 | 4971 → 284 | 4899 → 264 |
| 1000 | 256 | 34749 → 29937 | 34242 → 1147 | 34184 → 1125 |
| 1000 | 65536 | 31630 → 30229 | 31085 → 1274 | 31046 → 1243 |

Home 锁持有下降 76.8–96.7%，外部锁下降 77.9–96.7%，总耗时下降 4.4–31.8%。执行前完整源/插件/内容和目标复验保留；千资产仍持 Home 锁约 1.1–1.3 秒。资源锁可长期持有，不等于事务锁。

库存字节增加 934 或 131494（最多 2.5%），Journal 每组仍写 11 次。嵌套计时重叠不能相加；Journal 字节是序列化次数，不是设备写放大。单次本机结果不是 p95、跨机器保证，也不衡量大量已安装 placement、网络、GC 或吞吐。进程争用由独立测试覆盖，发布验收见[1.1.0](../../../releases/1.1.0/validation.md)。复现见[基准指南](../../../guides/benchmarking.md)。
