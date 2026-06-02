"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent, TooltipComponent, LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export interface ActivityChartData {
  days: string[];
  notes: number[];
  reviews: number[];
}

export default function ActivityChart({ data }: { data: ActivityChartData }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current);
    const ro = new ResizeObserver(() => inst.current?.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); inst.current?.dispose(); };
  }, []);

  useEffect(() => {
    if (!inst.current) return;
    const labels = data.days.map(d => d.slice(5));
    inst.current.setOption({
      animation: true,
      grid: { left: 4, right: 8, top: 28, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(15,23,42,0.92)",
        borderWidth: 0,
        textStyle: { color: "#f8fafc", fontSize: 11 },
        formatter(params: unknown) {
          const items = params as { seriesName: string; value: number; axisValue: string }[];
          const note = items.find(p => p.seriesName === "笔记")?.value ?? 0;
          const rev = items.find(p => p.seriesName === "复盘")?.value ?? 0;
          return `${items[0]?.axisValue}<br/>笔记 ${note} · 复盘 ${rev}`;
        },
      },
      legend: {
        data: ["笔记", "复盘"],
        top: 0, right: 0,
        itemWidth: 8, itemHeight: 8,
        textStyle: { fontSize: 10, color: "#64748b" },
      },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 9, color: "#94a3b8", interval: 4 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        splitLine: { lineStyle: { color: "#f1f5f9", type: "dashed" } },
        axisLabel: { fontSize: 9, color: "#94a3b8" },
      },
      series: [
        {
          name: "笔记",
          type: "line",
          smooth: 0.35,
          symbol: "circle",
          symbolSize: 4,
          showSymbol: false,
          lineStyle: { width: 2, color: "#6366f1" },
          itemStyle: { color: "#6366f1" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(99,102,241,0.28)" },
              { offset: 1, color: "rgba(99,102,241,0.02)" },
            ]),
          },
          data: data.notes,
        },
        {
          name: "复盘",
          type: "line",
          smooth: 0.35,
          symbol: "circle",
          symbolSize: 4,
          showSymbol: false,
          lineStyle: { width: 2, color: "#10b981" },
          itemStyle: { color: "#10b981" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(16,185,129,0.22)" },
              { offset: 1, color: "rgba(16,185,129,0.02)" },
            ]),
          },
          data: data.reviews,
        },
      ],
    }, true);
  }, [data]);

  return <div ref={ref} style={{ width: "100%", height: "100%", minHeight: 120 }} />;
}
