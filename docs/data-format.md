# 数据格式

数据全部在 `data/`，UTF-8，CSV 使用标准引号转义。可以直接用 Excel / 文本编辑器改，服务每次请求都会重新读取。

所有体重、腰围单位：**斤**（1 kg = 2 斤）。

## data/profile.json

个人参数，服务启动时读取。缺字段会使用代码里的默认值。

| 字段 | 类型 | 说明 |
|---|---|---|
| `sex` | `"male"` / `"female"` | 用于 Mifflin-St Jeor BMR 公式 |
| `age` | number | 岁 |
| `heightCm` | number | 厘米 |
| `startWeight` | number | 趋势基准体重（斤），通常取第 1 天早晨空腹 |
| `goal` | number | 默认目标体重（斤）；实际目标以 `目标.json` 为准 |
| `holiday` | string | 目标日期 `YYYY-MM-DD` |
| `kcalLo` / `kcalHi` | number | 每日热量目标区间 |
| `protHardFloor` | number | 蛋白硬底线（g） |
| `protPerKgLo` / `protPerKgHi` | number | 每 kg 去脂体重的蛋白目标 |
| `bodyFatLo` / `bodyFatHi` | number | 体脂率估计区间（0~1） |

## data/weight.csv

```csv
date,day,weight,note
2026-09-03,0,182.0,第 0 天晚上称重
2026-09-04,1,181.0,晨起空腹
2026-09-05,2,181.0,训练后
```

| 列 | 说明 |
|---|---|
| `date` | `YYYY-MM-DD`，主键 |
| `day` | 第几天；服务端会按日期重新计算，可留空 |
| `weight` | 斤，保留 1 位小数 |
| `note` | 任意文本，可空 |

`day = 0` 的记录会被统计排除（通常是晚上裸重，与早晨空腹条件不同）。同一天重复提交会覆盖，不会写重。

## data/intake.csv

一行代表一餐 / 一个食物条目，同一天的多行会累加。

```csv
date,day,meal,summary,kcal,p,high_na,complete,certainty,oil_g
2026-09-04,1,早餐,燕麦+牛奶+鸡蛋,420,22,0,1,1,
2026-09-04,1,午餐,鸡腿x2+米饭+青菜,780,45,0,1,1,5
```

| 列 | 说明 |
|---|---|
| `meal` | 早餐 / 午餐 / 晚餐 / 加餐；`校正` 行不进入明细 |
| `summary` | 文本；`鸡腿x2`、`鸡腿 2` 会被识别为 2 只鸡腿 |
| `kcal` | 热量 |
| `p` | 蛋白（g） |
| `high_na` | `1` = 高钠 |
| `complete` | `1` = 当天记录完整；`0` 不进入“近 7 天均值” |
| `certainty` | `0` = 估算值 |
| `oil_g` | 每只鸡腿残留油克数（0 / 5 / 10），仅鸡腿行需要 |

净热量 = `kcal + 鸡腿数 × oil_g × 9`。

## data/waist.csv

```csv
date,cm,note
2026-09-05,104.0,晨起空腹
```

同一天重复记录会覆盖。

## data/sleep.csv

```csv
date,period,bed,wake,hours,note
2026-09-04,在校,23:30,07:30,8.0,
```

## data/training.csv

```csv
date,type,detail,minutes,kcal,note
2026-09-04,力量,上肢+核心,40,220,
```

睡眠和训练目前只做归档，不参与趋势计算。

## data/目标.json

```json
{
  "goal": 160,
  "history": [
    { "goal": 165, "note": "被 160 斤替换", "setAt": "2026-09-01" }
  ],
  "backup": 160
}
```

- `goal`：当前目标
- `history`：历次旧目标，界面会展示
- `backup`：最初的基准目标，改目标时不会丢

界面上的「调整目标」会自己维护这个文件，一般不用手改。

## data/排除.json

```json
[
  {
    "date": "2026-09-20",
    "reason": "当天只记录到早餐，次日出现孤立低点，标记为不可信"
  }
]
```

被排除的日期不参与趋势拟合，但仍保留在明细表里，可以随时恢复。

## 生成示例数据

```bash
npm run seed
```

脚本会覆盖 `data/` 下的 CSV、`目标.json`、`排除.json`、`profile.json`。它使用固定随机种子，每次生成同一份数据。
