"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Zap, Check, FileText, Sparkles, Flame,
  ClipboardList, RotateCw, MessageSquarePlus, GripVertical,
  History, X, Copy
} from "lucide-react";
import { apiClient, API_BASE, type NoteItem, type Todo, type Review } from "@/lib/api";
import type { ApiStatus, ApiModels, SearchResult } from "@/lib/types";
import { useActiveModel } from "@/lib/hooks";
import Sidebar from "@/components/Sidebar";
import ActivityChart from "@/components/ActivityChart";
import Markdown from "@/components/Markdown";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface InsightRun { id: string; key: string; name: string; emoji: string; prompt: string; answer: string; sources: SearchResult[]; createdAt: string }

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

// FloMo 风格的 AI 洞察视角（点击后用该视角的提示词去对话页读你的笔记）
interface Insight { key: string; name: string; emoji: string; desc: string; prompt: string }
const INSIGHTS: Insight[] = [
  { key: "default", name: "默认洞察", emoji: "👁️", desc: "多视角综合审视", prompt: "你是我的专属思考伙伴。请深度阅读我的这些笔记，综合分析：①提炼贯穿其中的1-3个核心主题；②指出我反复在记、可能没意识到的隐藏模式；③从第三方视角提出1-2个我不曾想到却值得深思的好问题。引用我笔记里的原话作为证据，真诚克制，不替我下结论。" },
  { key: "friend", name: "朋友视角", emoji: "🧑‍🤝‍🧑", desc: "像好朋友一样直率反馈", prompt: "你是相识多年、真心希望我变好的好朋友。读完我的笔记，像朋友聊天一样跟我说几句心里话：看到我最近在意什么、状态如何，哪里为我高兴，哪里有点担心。说一些哪怕知心朋友也未必敢当面说、但你愿意坦诚告诉我的真话。温暖但不回避，用「你」称呼我，别客套说教。" },
  { key: "action", name: "行动指南", emoji: "🎯", desc: "把想法变成下一步", prompt: "你是务实的行动教练。基于我的笔记，识别我当前最想推进却没落地的1-2件事，给出符合我现状的具体方案：拆成本周就能开始的最小一步，标明卡点与对策，别空泛口号。最后一句话点明：如果只做一件事，应该是什么。" },
  { key: "blindspot", name: "盲区探索", emoji: "🕳️", desc: "照见你没意识到的盲点", prompt: "你擅长发现别人看不到的盲区。读完我的笔记，找出我思维或行为中的盲点：我反复忽略、回避或视而不见的角度和事实；我自以为正确、其实可能站不住脚的假设。直接指出并说明为什么是盲区，再给一个帮我跳出盲区的提问。坦率，不必照顾面子。" },
  { key: "soul", name: "灵魂拷问", emoji: "🔥", desc: "问出你不敢面对的真相", prompt: "你是犀利而真诚的提问者。从我的笔记里提炼出3条我看不见却可能改变我的真相，转化为3个直击灵魂的问题。要扎心、切中我一直回避的核心，不要安慰铺垫。每个问题配一句简短说明，点出笔记中暴露这点的蛛丝马迹。" },
  { key: "explore", name: "探索", emoji: "🧭", desc: "打开没想过的可能性", prompt: "你是充满好奇心的探索伙伴。基于我的笔记，识别我感兴趣的方向并向外延展：推荐我可能喜欢却还没接触的相邻话题、视角、人物或工具，抛出几个开放性的「如果……会怎样」。目的不是收敛，而是帮我打开新的可能、激发好奇。" },
  { key: "compound", name: "复利", emoji: "📈", desc: "找到值得长期投入的事", prompt: "你深谙复利思维。读完我的笔记，用「复利」框架分析：哪些是我正在做、能随时间不断累积、越往后回报越大的事；哪些是看似忙碌却无法积累、做完即清零的消耗。指出我的精力是否押在有复利的地方，建议我该加码什么、减少什么。" },
  { key: "flywheel", name: "飞轮", emoji: "⚙️", desc: "找到自我增强的正循环", prompt: "你擅长系统思考。基于我的笔记，用「飞轮效应」分析我的成长与生活：找出能彼此驱动、形成正向自我增强循环的几个环节（A推动B、B推动C、C又加强A），画出这个飞轮。指出当前卡住飞轮的阻力点，以及我先推哪一环整个循环最容易转起来。" },
  { key: "clarify", name: "价值澄清", emoji: "💎", desc: "看清你真正看重什么", prompt: "你帮人澄清内在价值。读完我的笔记，从我反复出现的选择、纠结和情绪中，提炼我真正看重的核心价值（哪怕我没明说）。指出我表面追求的与行为实际偏向的之间是否矛盾，用笔记原话佐证，最后帮我把最重要的2-3个价值排序。" },
  { key: "reverse", name: "逆向思考", emoji: "🔄", desc: "反过来想，避开最坏", prompt: "你擅长逆向思考，信奉「反过来想，总是反过来想」。基于我的笔记，对我正在追求的目标做逆向推演：如果想让这件事彻底失败，需要做什么？据此反推我现在最该避免的陷阱和最该守住的底线，帮我看清正面思考遗漏的风险。" },
  { key: "second_order", name: "二阶思考", emoji: "🪜", desc: "想清楚「然后呢」", prompt: "你是训练有素的二阶思考者。针对我笔记里的某个想法或决定，不停留在第一层后果，继续追问「然后呢？再然后呢？」：推演二阶、三阶后果，包括延迟的、间接的、易被忽略的连锁影响。指出哪些选择第一层看着不错、更长链条上却会反噬。" },
  { key: "cbt", name: "CBT 疗法", emoji: "🧩", desc: "松动认知扭曲", prompt: "你是受过认知行为疗法（CBT）训练的咨询师。用 CBT 框架读我的笔记：识别反复出现的自动化负面想法和认知扭曲（非黑即白、灾难化、以偏概全、应该式思维等），命名它们；再温和地与我一起检验证据，提供更平衡现实的替代解读。接纳不评判，最后给一个可练习的小行动。" },
  { key: "mbti", name: "MBTI 分析", emoji: "🧠", desc: "从性格类型读懂你", prompt: "你熟悉 MBTI 人格理论。读我的笔记，从表达方式、关注点和决策偏好推测我的 MBTI 类型，对四个维度（E/I、N/S、T/F、J/P）逐一给出依据并引用我的原话。说明这种性格的优势、易踩的坑，以及更适合我的做事和相处方式。注明这只是基于笔记的推测。" },
  { key: "socratic", name: "苏格拉底", emoji: "❓", desc: "用追问帮你想更深", prompt: "你是苏格拉底，从不直接给答案，只用提问帮人自己想明白。针对我笔记里的观点或困惑，用层层递进的苏格拉底式追问：先请我界定概念，再检验假设和证据，暴露矛盾，引导我自己抵达更清晰的结论。一次抛出3-5个环环相扣的问题，谦逊好奇，不下定论。" },
  { key: "sharp", name: "毒舌模式", emoji: "🌶️", desc: "犀利吐槽，专治自我感动", prompt: "你是嘴毒但心善、绝不说场面话的损友。读完我的笔记，毫不留情地吐槽我：戳破自我感动、空想、拖延和借口，把我嘴上漂亮、行动拉胯的地方一一抖出来。可以辛辣扎心，但每句吐槽背后都要有道理、是为我好。最后留一句真正有用的狠话点醒我。" },
  { key: "persona", name: "人物画像", emoji: "🪞", desc: "为你勾一幅自画像", prompt: "你善于洞察人。综合我的笔记，为我勾勒一幅立体的人物画像：我是怎样的人——兴趣与热情、价值取向、思维习惯、情绪模式、在意与回避的东西、潜在需求。像速写一样描述我，引用笔记原话佐证，让我读完有「原来我是这样」的照镜子之感。真诚，不奉承也不刻薄。" },
  { key: "bias", name: "思维盲点", emoji: "🌫️", desc: "系统梳理思维误区", prompt: "你研究认知偏误。系统审视我的笔记，梳理我反复出现的思维盲点与认知偏误（确认偏误、幸存者偏差、沉没成本、近因效应、过度自信等），逐条命名、解释，并引用笔记中触发它的片段。最后给每个盲点一句「纠偏提醒」，帮我下次能及时察觉。" },
];

const AI_TIPS = [
  { quote: "你最近几周都在积累笔记，但还没动手做项目。", body: "知识只有落地才会留存。建议本周挑一个小项目，把最近学的东西实践一遍。", proj: "推荐项目：做一个小工具", meta: "预估 8 小时 · 覆盖你近期 80% 的笔记" },
  { quote: "你的复盘频率在下降。", body: "复盘是把经验变成认知的关键一步。建议今晚花 15 分钟，回顾本周做对和做错的事。", proj: "推荐动作：写一篇周复盘", meta: "预估 15 分钟 · 巩固本周所学" },
  { quote: "有几条笔记一直没有归类。", body: "未归类的笔记很难被再次找到。让 AI 帮你批量命名和归档，知识库会更清晰。", proj: "推荐动作：AI 批量命名笔记", meta: "一键处理 · 让知识库可检索" },
  { quote: "你设置了目标，但进展偏慢。", body: "大目标容易拖延。把其中一个拆成今天能完成的 30 分钟小步骤，先动起来。", proj: "推荐动作：拆解今日目标", meta: "先完成最小一步 · 建立 momentum" },
  { quote: "最近笔记多、连接少。", body: "孤立笔记价值有限。挑 3 条相关笔记，让 AI 帮你串成一条思路线。", proj: "推荐动作：串联相关笔记", meta: "在对话中用 @ 引用 · 生成主题脉络" },
  { quote: "知识库在涨，但检索用得少。", body: "写下来的东西要能被再次找到才有意义。下次提问时开启自动检索，让 AI 从你的笔记里找答案。", proj: "推荐动作：用笔记回答一个问题", meta: "打开 AI 对话 · 自动检索已开启" },
];
const VISIBLE_TIP_COUNT = 3;

// ─── 可拖动 / 可调大小的小组件网格（纯 CSS grid + size，无 slot） ───
const WIDGET_IDS = ["hero", "notion", "kb", "tip", "recent", "goals", "chart", "sys"] as const;
type WidgetId = typeof WIDGET_IDS[number];
type WSize = "sm" | "md" | "lg";
/** 列跨度：sm=1 / md=2 / lg=4（6 列 grid） */
const WSIZE_SPAN: Record<WSize, number> = { sm: 1, md: 2, lg: 4 };
/** 行跨度：以 sm 高度为 1 行；md/lg 各占 2 行，使 lg 右侧可叠两排 sm */
const WSIZE_ROW: Record<WSize, number> = { sm: 1, md: 2, lg: 2 };
const WSIZE_LABEL: Record<WSize, string> = { sm: "小", md: "中", lg: "大" };
/** 默认尺寸：hero 左大(lg=4列)；右侧 goals/sys/notion 均为 sm(1列)，自然留 1 格空白 */
const DEFAULT_SIZES: Record<WidgetId, WSize> = {
  hero: "lg", goals: "sm", sys: "sm", notion: "sm",
  kb: "sm", tip: "md", recent: "md", chart: "lg",
};

/**
 * 默认顺序（6 列 grid + dense）：
 *  hero(4) | goals(1) | sys(1)
 *          | notion(1) | (自然空)
 *  其余 kb / tip / recent / chart 顺排
 */
const DEFAULT_ORDER: WidgetId[] = ["hero", "goals", "sys", "notion", "kb", "tip", "recent", "chart"];

const isWidgetId = (id: string): id is WidgetId =>
  (WIDGET_IDS as readonly string[]).includes(id);

/** 去重 + 补齐 8 个 widget，保持出现顺序 */
function normalizeOrder(input: string[]): WidgetId[] {
  const seen = new Set<WidgetId>();
  const out: WidgetId[] = [];
  for (const id of input) {
    if (isWidgetId(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of WIDGET_IDS) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

/**
 * localStorage 迁移：
 * - string[] → 规范化 WidgetId[]
 * - GridCell[]（旧）→ 丢弃 kind:'slot' 结构，只保留 widget id 顺序
 */
function migrateOrder(raw: unknown): WidgetId[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_ORDER];

  if (typeof raw[0] === "string") {
    return normalizeOrder(raw as string[]);
  }

  if (typeof raw[0] === "object" && raw[0] !== null && "kind" in (raw[0] as object)) {
    const ids: string[] = [];
    for (const c of raw as Array<Record<string, unknown>>) {
      if (!c || typeof c !== "object") continue;
      if (c.kind === "widget" && typeof c.id === "string") {
        ids.push(c.id);
      } else if (c.kind === "slot" && typeof c.filledBy === "string") {
        ids.push(c.filledBy);
      }
    }
    return ids.length ? normalizeOrder(ids) : [...DEFAULT_ORDER];
  }

  return [...DEFAULT_ORDER];
}

function WidgetToolbar({ id, size, setSize, dragHandle }: {
  id: string; size: WSize; setSize: (id: string, s: WSize) => void;
  dragHandle: React.HTMLAttributes<HTMLSpanElement>;
}) {
  return (
    <div className="widget-toolbar">
      {(["sm", "md", "lg"] as WSize[]).map((s) => (
        <button key={s}
          className={`widget-size-btn${size === s ? " active" : ""}`}
          onClick={() => setSize(id, s)}
          title={`模块大小：${WSIZE_LABEL[s]}`}>{WSIZE_LABEL[s]}</button>
      ))}
      <span className="widget-grip" title="按住拖动换位置（上下左右）" {...dragHandle}>
        <GripVertical size={13} />
      </span>
    </div>
  );
}

function SortableWidget({ id, size, setSize, children, dragActive, activeSize, isOverTarget }: {
  id: WidgetId; size: WSize; setSize: (id: string, s: WSize) => void;
  children: React.ReactNode; dragActive: boolean; activeSize: WSize; isOverTarget: boolean;
}) {
  // useSortable 内含 droppable：arrayMove 重排 + 参与 coverageCollision 碰撞
  // isOverTarget 由上层 onDragOver 驱动（比 hook 内 isOver 更稳，避免双 id 注册）
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({
    id,
    animateLayoutChanges: () => false,
  });

  // 命中时仅占位框尺寸跟随正在拖动的 widget，widget 本身保持原 size
  const showOver = dragActive && isOverTarget && !isDragging;
  const placeholderSize = showOver ? activeSize : size;

  const style: React.CSSProperties = {
    gridColumn: `span ${WSIZE_SPAN[size]}`,
    gridRow: `span ${WSIZE_ROW[size]}`,
    transform: dragActive ? undefined : CSS.Transform.toString(transform),
    transition: dragActive ? undefined : transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "widget-cell",
        `size-${size}`,
        isDragging ? "is-dragging" : "",
        showOver ? "is-over" : "",
      ].filter(Boolean).join(" ")}
      data-widget-id={id}
      data-placeholder-size={showOver ? placeholderSize : undefined}
    >
      <WidgetToolbar id={id} size={size} setSize={setSize} dragHandle={{ ...attributes, ...listeners }} />
      {children}
      {showOver && (
        <div
          className={`widget-placeholder size-${placeholderSize}`}
          data-placeholder-size={placeholderSize}
        >
          <span>放这里 · {placeholderSize === "sm" ? "小" : placeholderSize === "md" ? "中" : "大"}</span>
        </div>
      )}
    </div>
  );
}

function WidgetGrid({ order, setOrder, sizes, setSize, render }: {
  order: WidgetId[];
  setOrder: (o: WidgetId[]) => void;
  sizes: Record<string, WSize>;
  setSize: (id: string, s: WSize) => void;
  render: Record<string, React.ReactNode>;
}) {
  const seq = order.length ? normalizeOrder(order) : [...DEFAULT_ORDER];
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // 用 ref 记录上一次 over id，避免 onDragOver 同 id 重复 setState
  const lastOverRef = useRef<string | null>(null);
  // 节流：避免 onDragOver 高频 setState（pointer 在边界抖时）
  const lastOverTsRef = useRef(0);
  // 与 onDragOver 同步的稳定 over（历史字段；drop 以 collisionResultRef 为准）
  const lastStableOverRef = useRef<string | null>(null);
  // 拖动起点 rect（onDragStart 记录；保留作未来扩展/调试，coverageCollision 不再使用）
  const activeStartRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  // collisionDetection 选出的 drop 目标（高亮 ≡ 松手目标，避免两套算法不一致）
  const collisionResultRef = useRef<{ id: string; coverage: number } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const dragActive = activeId !== null;
  const activeSize: WSize = activeId
    ? (sizes[activeId] || DEFAULT_SIZES[activeId as WidgetId] || "sm")
    : "sm";

  /**
   * pointerHits-only collision:
   * 鼠标中心点 (pointerCoordinates) 必须严格落在某个 widget 矩形内，才算 drop 目标。
   * 不再用覆盖率兜底——大模块边缘擦到小模块 ≥ 30% 时会提前提示，用户反馈不准。
   *
   * 结果写入 collisionResultRef，onDragEnd 复用（高亮 ≡ drop）
   */
  const coverageCollision: CollisionDetection = useCallback((args) => {
    const activeIdStr = String(args.active.id);
    if (!args.pointerCoordinates) {
      collisionResultRef.current = null;
      return [];
    }

    // ─── 只保留阶段 1: pointerHits — 鼠标中心点严格落在 widget 矩形内 ───
    let bestId: string | null = null;

    for (const container of args.droppableContainers) {
      const id = String(container.id);
      if (id === activeIdStr) continue;
      const el = container.node.current;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const px = args.pointerCoordinates.x;
      const py = args.pointerCoordinates.y;
      if (px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height) {
        bestId = id;
        break; // 第一个命中即可
      }
    }

    if (bestId) {
      collisionResultRef.current = { id: bestId, coverage: 1.0 };
      return [{ id: bestId }];
    }
    collisionResultRef.current = null;
    return [];
  }, []);

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setOverId(null);
    lastOverRef.current = null;
    lastOverTsRef.current = 0;
    lastStableOverRef.current = null;
    collisionResultRef.current = null;
    // 记录拖动起点 rect（保留作未来扩展/调试）
    if (typeof document !== 'undefined') {
      const activeEl = document.querySelector(`.widget-cell[data-widget-id="${e.active.id}"]`);
      if (activeEl) {
        const ar = activeEl.getBoundingClientRect();
        activeStartRectRef.current = { x: ar.x, y: ar.y, width: ar.width, height: ar.height };
      } else {
        activeStartRectRef.current = null;
      }
    } else {
      activeStartRectRef.current = null;
    }
  }

  function onDragOver(e: DragOverEvent) {
    const raw = e.over ? String(e.over.id) : null;
    const next = raw && raw !== String(e.active.id) ? raw : null;
    // 同 id 跳过 setState（防闪烁）
    if (next === lastOverRef.current) {
      lastOverTsRef.current = Date.now();
      return;
    }
    lastOverRef.current = next;
    lastStableOverRef.current = next;
    lastOverTsRef.current = Date.now();
    setOverId(next);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active } = e;
    // 最小拖动距离检查 — 欧氏距离 < 20px 视为误触，不挪动
    const MIN_DRAG_DIST = 20;
    const dx = e.delta?.x ?? 0;
    const dy = e.delta?.y ?? 0;
    if (Math.hypot(dx, dy) < MIN_DRAG_DIST) {
      setActiveId(null);
      setOverId(null);
      lastOverRef.current = null;
      lastOverTsRef.current = 0;
      lastStableOverRef.current = null;
      activeStartRectRef.current = null;
      collisionResultRef.current = null;
      return;
    }

    // 优先用 collisionDetection 的结果（提示 = drop，避免两套 active 位置算法不一致）
    let overIdFinal: string | null = collisionResultRef.current?.id ?? null;
    collisionResultRef.current = null;

    setActiveId(null);
    setOverId(null);
    lastOverRef.current = null;
    lastOverTsRef.current = 0;
    lastStableOverRef.current = null;
    activeStartRectRef.current = null;
    if (!overIdFinal || active.id === overIdFinal) return;

    const activeStr = String(active.id);
    const overStr = overIdFinal;
    if (!isWidgetId(activeStr) || !isWidgetId(overStr)) return;

    // 拖 widget → 落 widget：arrayMove 重排
    const oi = seq.indexOf(activeStr);
    const ni = seq.indexOf(overStr);
    if (oi >= 0 && ni >= 0) {
      setOrder(arrayMove(seq, oi, ni));
    }
    // 跨尺寸拖动时，按落点的 size 重排 active（避免 lg 拖到 sm 位导致 grid 排版乱）
    const activeSize: WSize = sizes[activeStr] || DEFAULT_SIZES[activeStr] || "sm";
    const overSize: WSize = sizes[overStr] || DEFAULT_SIZES[overStr] || "sm";
    if (activeSize !== overSize) {
      setSize(activeStr, overSize);
    }
  }

  function onDragCancel() {
    setActiveId(null);
    setOverId(null);
    lastOverRef.current = null;
    lastOverTsRef.current = 0;
    lastStableOverRef.current = null;
    activeStartRectRef.current = null;
    collisionResultRef.current = null;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={coverageCollision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <SortableContext items={seq} strategy={rectSortingStrategy}>
        <div className={`widget-grid${dragActive ? " is-dragging" : ""}`}>
          {seq.map((id) => {
            const size = sizes[id] || DEFAULT_SIZES[id] || "sm";
            return (
              <SortableWidget
                key={id}
                id={id}
                size={size}
                setSize={setSize}
                dragActive={dragActive}
                activeSize={activeSize}
                isOverTarget={overId === id}
              >
                {render[id]}
              </SortableWidget>
            );
          })}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2,0,0,1)" }}>
        {activeId ? (
          <div className={`widget-cell size-${activeSize} widget-floating`}>
            {render[activeId]}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [models, setModels] = useState<ApiModels | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [heroInput, setHeroInput] = useState("");
  const [tipIdx, setTipIdx] = useState(0);
  const [meta, setMeta] = useState<{ greet: string; date: string }>({ greet: "你好", date: "" });
  const [usage, setUsage] = useState<Record<string, number>>({});
  const { active } = useActiveModel();
  const [insOpen, setInsOpen] = useState(false);
  const [insRun, setInsRun] = useState<InsightRun | null>(null);
  const [insLoading, setInsLoading] = useState(false);
  const [insHistory, setInsHistory] = useState<InsightRun[]>([]);
  const [histOpen, setHistOpen] = useState(false);
  const [widgetOrder, setWidgetOrderState] = useState<WidgetId[]>([]);
  const [widgetSizes, setWidgetSizesState] = useState<Record<string, WSize>>({});
  const [mounted, setMounted] = useState(false);
  function setWidgetOrder(o: WidgetId[]) {
    const next = normalizeOrder(o);
    setWidgetOrderState(next);
    try { localStorage.setItem("dash_widget_order", JSON.stringify(next)); } catch {}
  }
  function setWidgetSize(id: string, s: WSize) {
    setWidgetSizesState(prev => { const next = { ...prev, [id]: s }; try { localStorage.setItem("dash_widget_sizes", JSON.stringify(next)); } catch {} return next; });
  }

  const loadAll = useCallback(async () => {
    try {
      const [s, m, n, t, r] = await Promise.all([
        apiClient.getStatus(), apiClient.getModels(), apiClient.getNotes(),
        apiClient.getTodos(), apiClient.getReviews(),
      ]);
      setStatus(s); setModels(m); setNotes(n.notes || []); setTodos(t.todos || []); setReviews(r.reviews || []);
    } catch (e) { console.error("Failed to load:", e); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // 客户端计算时间（避免水合不一致）
  useEffect(() => {
    const d = new Date();
    const h = d.getHours();
    const greet = h < 6 ? "凌晨好" : h < 12 ? "上午好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
    const date = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${WEEK[d.getDay()]}`;
    setMeta({ greet, date });
    setMounted(true);
    try { const u = localStorage.getItem("ai_insight_usage"); if (u) setUsage(JSON.parse(u)); } catch {}
    try { const h = localStorage.getItem("ai_insight_history"); if (h) setInsHistory(JSON.parse(h)); } catch {}
    try {
      const a = localStorage.getItem("dash_widget_order");
      if (a) {
        const migrated = migrateOrder(JSON.parse(a));
        setWidgetOrderState(migrated);
        // 写回 string[] schema，完成一次性升级（丢弃旧 slot cell）
        try { localStorage.setItem("dash_widget_order", JSON.stringify(migrated)); } catch {}
      } else {
        setWidgetOrderState([...DEFAULT_ORDER]);
      }
    } catch {
      setWidgetOrderState([...DEFAULT_ORDER]);
    }
    try { const a = localStorage.getItem("dash_widget_sizes"); if (a) setWidgetSizesState(JSON.parse(a)); } catch {}
  }, []);

  async function doSync() {
    setSyncing(true);
    try { await apiClient.sync(); await loadAll(); } finally { setSyncing(false); }
  }

  function goChat(q?: string) {
    const query = (q ?? heroInput).trim();
    router.push(query ? `/chat?q=${encodeURIComponent(query)}` : "/chat");
  }

  // 点击视角：弹窗内流式展示（默认读取全部笔记），不再跳转到 AI 对话页
  async function runInsight(ins: Insight) {
    const nextUsage = { ...usage, [ins.key]: (usage[ins.key] || 0) + 1 };
    setUsage(nextUsage);
    try { localStorage.setItem("ai_insight_usage", JSON.stringify(nextUsage)); } catch {}

    const run: InsightRun = {
      id: Math.random().toString(36).slice(2, 10),
      key: ins.key, name: ins.name, emoji: ins.emoji, prompt: ins.prompt,
      answer: "", sources: [], createdAt: new Date().toISOString(),
    };
    setInsRun(run); setInsOpen(true); setHistOpen(false); setInsLoading(true);

    let full = ""; let srcs: SearchResult[] = [];
    try {
      const res = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // all_notes=true = 综合全部笔记作为参考（洞察模块默认行为）
        body: JSON.stringify({ query: ins.prompt, provider: active.provider, model: active.model, no_rag: false, all_notes: true }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim(); if (!line.startsWith("data:")) continue;
          let evt: { type: string; text?: string; sources?: SearchResult[] };
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.type === "sources") { srcs = evt.sources || []; setInsRun(r => r ? { ...r, sources: srcs } : r); }
          else if (evt.type === "delta" || evt.type === "error") { full += evt.text || ""; setInsRun(r => r ? { ...r, answer: full } : r); }
        }
      }
      if (!full.trim()) full = "（模型没有返回内容，请确认所选模型服务可用）";
    } catch (e) {
      full = `请求失败：${e instanceof Error ? e.message : String(e)}`;
    } finally {
      setInsLoading(false);
      const finalRun = { ...run, answer: full, sources: srcs };
      setInsRun(finalRun);
      setInsHistory(prev => {
        const next = [finalRun, ...prev].slice(0, 30);
        try { localStorage.setItem("ai_insight_history", JSON.stringify(next)); } catch {}
        return next;
      });
    }
  }
  const sortedInsights = [...INSIGHTS].sort((a, b) => (usage[b.key] || 0) - (usage[a.key] || 0));

  // ── 派生数据 ──
  const noteCount = status?.documents ?? notes.length;
  const currentModel = models?.current || "本地模型";
  const recentNotes = [...notes].sort((a, b) => (b.updated || "").localeCompare(a.updated || "")).slice(0, 10);
  const pendingTodos = todos.filter(t => !t.completedAt);
  const visibleTips = Array.from({ length: VISIBLE_TIP_COUNT }, (_, i) => AI_TIPS[(tipIdx + i) % AI_TIPS.length]);

  // 本周完成数
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)); weekStart.setHours(0, 0, 0, 0);
  const doneThisWeek = todos.filter(t => t.completedAt && new Date(t.completedAt) >= weekStart).length;

  // 分类占比（按 database 分组）
  const catCounts: Record<string, number> = {};
  for (const n of notes) { const k = n.database || "其他"; catCounts[k] = (catCounts[k] || 0) + 1; }
  const total = notes.length || 1;
  const cats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v], i) => ({ name: k, pct: Math.round((v / total) * 100), color: ["var(--brand-500)", "#10b981", "#f59e0b"][i] }));
  const catSum = cats.reduce((s, c) => s + c.pct, 0);
  if (catSum < 100) cats.push({ name: "其他", pct: 100 - catSum, color: "#cbd5e1" });

  const tip = visibleTips[0];

  // ── 活跃度：基于真实数据统计最近 30 天（笔记创建 + 复盘） ──
  const activity = (() => {
    const days: string[] = [];
    const base = new Date(); base.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(base); d.setDate(base.getDate() - i);
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    const idx: Record<string, number> = {}; days.forEach((d, i) => (idx[d] = i));
    const noteSeries = new Array(30).fill(0);
    const reviewSeries = new Array(30).fill(0);
    for (const n of notes) {
      const day = (n.created || n.updated || "").slice(0, 10);
      if (day in idx) noteSeries[idx[day]] += 1;
    }
    for (const r of reviews) {
      const day = (r.date || "").slice(0, 10);
      if (day in idx) reviewSeries[idx[day]] += 1;
    }
    for (const t of todos) {
      const day = (t.completedAt || "").slice(0, 10);
      if (day in idx) reviewSeries[idx[day]] += 0; // 完成项已计入复盘日历，这里只统计笔记/复盘
    }
    let streak = 0;
    for (let i = 29; i >= 0; i--) { if (noteSeries[i] + reviewSeries[i] > 0) streak++; else break; }
    const totalActive = noteSeries.reduce((a, b) => a + b, 0) + reviewSeries.reduce((a, b) => a + b, 0);
    return { days, noteSeries, reviewSeries, streak, totalActive };
  })();

  return (
    <div className="app-layout">
      <Sidebar activePage="home" />

      <main className="main dash">
        {/* 顶栏问候 */}
        <div className="dash-topbar">
          <div>
            <h1 className="dash-greet">{meta.greet}{meta.greet ? " 👋" : ""}</h1>
            <div className="dash-sub">{meta.date} · 你有 {pendingTodos.length} 条待处理 · 本周已完成 {doneThisWeek} 项</div>
          </div>
          <div className="dash-topbar-actions">
            <button className="btn-dark" onClick={doSync} disabled={syncing}>
              {syncing ? <Loader2 size={13} className="spin" /> : <Zap size={13} />} {syncing ? "同步中…" : "一键同步全部"}
            </button>
            <button className="btn-light" onClick={() => router.push("/chat")}>
              <MessageSquarePlus size={13} /> 新对话
            </button>
            <div className="dash-avatar">A</div>
          </div>
        </div>

        <div className="dash-content">
          {mounted && <WidgetGrid order={widgetOrder.length ? widgetOrder : [...DEFAULT_ORDER]} setOrder={setWidgetOrder} sizes={widgetSizes} setSize={setWidgetSize} render={{
            hero: (
              <div className="ai-hero card-fill">
                <button className="hero-history-btn" onClick={() => { setHistOpen(true); setInsOpen(true); }} title="查看历史记录">
                  <History size={13} /> 历史
                </button>
                <h2>今日洞察</h2>
                <p>选一个洞察视角，我用它来读你的笔记 · 共 {INSIGHTS.length} 个视角，可左右滑动</p>
                <div className="insight-scroll">
                  {sortedInsights.map(ins => (
                    <button key={ins.key} className="insight-card" onClick={() => runInsight(ins)} title={ins.desc}>
                      <span className="insight-emoji">{ins.emoji}</span>
                      <span className="insight-name">{ins.name}</span>
                      <span className="insight-desc">{ins.desc}</span>
                    </button>
                  ))}
                </div>
                <input className="hero-input" placeholder="或直接输入问题…（回车进入对话页）"
                  value={heroInput} onChange={e => setHeroInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") goChat(); }} />
              </div>
            ),
            notion: (
              <div className="card stat-card card-fill">
                <div className="stat-label">NOTION 同步状态</div>
                <div className="stat-online"><span className="dot green" /> 已连接 · 自动运行</div>
                <div className="stat-sub">{status?.last_sync ? `上次同步：${status.last_sync.replace("T", " ").slice(5, 16)}` : "检查更新中…"}</div>
                <div className="stat-green-box"><Check size={11} /> AI 自动命名已开启<br /><span>本周已为 {doneThisWeek || 0} 条笔记生成标题</span></div>
              </div>
            ),
            kb: (
              <div className="card stat-card card-fill">
                <div className="stat-label">知识库</div>
                <div className="stat-big">{noteCount}<span className="stat-big-unit">总笔记</span></div>
                <div className="stat-delta">+{doneThisWeek || 0} 本周</div>
                <div className="cat-bar">
                  {cats.map(c => <span key={c.name} style={{ width: `${c.pct}%`, background: c.color }} />)}
                </div>
                <div className="cat-legend">{cats.slice(0, 3).map(c => `${c.name} ${c.pct}%`).join(" · ")}</div>
                <div className="stat-index"><span style={{ color: "#10b981" }}>●</span> 向量索引：{noteCount}/{noteCount} ✓</div>
              </div>
            ),
            goals: (
              <div className="reminder-card card-fill">
                <div className="reminder-head">
                  <div>
                    <div className="reminder-label"><ClipboardList size={12} /> 今日目标提醒</div>
                    <div className="reminder-count">{pendingTodos.length} 条待处理</div>
                  </div>
                  <button className="reminder-btn" onClick={() => router.push("/calendar")}>查看目标 →</button>
                </div>
                <ul className="reminder-list">
                  {(pendingTodos.length ? pendingTodos.slice(0, 6).map(t => t.title) : ["暂无待处理目标，保持节奏 ✨"]).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            ),
            recent: (
              <div className="card card-fill">
                <div className="card-header">
                  <span className="card-title">最近记录</span>
                  <span className="card-more" onClick={() => router.push("/search")}>查看全部 →</span>
                </div>
                <div className="recent-notes">
                  {recentNotes.length === 0 && <div className="empty-state">暂无笔记</div>}
                  {recentNotes.map(n => (
                    <div key={n.id} className="recent-note" onClick={() => router.push("/search")}>
                      <div className="rn-icon"><FileText size={13} style={{ color: "var(--brand-500)" }} /></div>
                      <div className="rn-body">
                        <div className="rn-title">{n.title}</div>
                        <div className="rn-meta">{n.database || "笔记"} · {n.updated ? n.updated.slice(0, 10) : "最近"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ),
            tip: (
              <div className="ai-tip-card">
                <div className="ai-tip-label"><Sparkles size={12} /> AI 给你的建议</div>
                <div className="ai-tip-list">
                  {visibleTips.map((t, i) => (
                    <div key={`${tipIdx}-${i}`} className="ai-tip-item">
                      <div className="ai-tip-quote">“{t.quote}”</div>
                      <div className="ai-tip-body">{t.body}</div>
                      <div className="ai-tip-proj">
                        <div className="ai-tip-proj-title">→ {t.proj}</div>
                        <div className="ai-tip-proj-meta">{t.meta}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="ai-tip-actions">
                  <button className="btn-tip-primary" onClick={() => goChat(tip.proj)}>采纳建议 →</button>
                  <button className="btn-ghost-sm" onClick={() => setTipIdx((tipIdx + VISIBLE_TIP_COUNT) % AI_TIPS.length)}>换一批</button>
                </div>
              </div>
            ),
            chart: (
              <div className="card activity-card">
                <div className="card-header">
                  <span className="card-title">活跃度（最近 30 天）</span>
                  {activity.streak > 0
                    ? <span className="streak"><Flame size={12} style={{ color: "#f97316" }} /> 连续 {activity.streak} 天活跃</span>
                    : <span className="streak" style={{ color: "var(--sb-text-muted)" }}>近期暂无记录</span>}
                </div>
                <div className="chart-wrap">
                  {activity.totalActive === 0 ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sb-text-muted)", fontSize: 12, minHeight: 120 }}>
                      最近 30 天还没有笔记或复盘记录
                    </div>
                  ) : (
                    <div className="activity-chart-area">
                      <ActivityChart data={{ days: activity.days, notes: activity.noteSeries, reviews: activity.reviewSeries }} />
                    </div>
                  )}
                </div>
              </div>
            ),
            sys: (
              <div className="sys-card" style={{ height: "100%" }}>
                <div className="sys-label"><RotateCw size={12} /> 系统状态</div>
                {[
                  { label: "本地模型", ok: true },
                  { label: "Notion API", ok: !status?.last_error },
                  { label: "向量数据库", ok: true },
                  { label: "文件监听", ok: true, val: `${status?.databases?.length || 0} 个库` },
                ].map(r => (
                  <div key={r.label} className="sys-row">
                    <span>{r.label}</span>
                    <span className="sys-val"><span className="dot green" /> {r.val || "正常"}</span>
                  </div>
                ))}
                <div className="sys-foot">所有服务运行正常 · {currentModel.slice(0, 18)}</div>
              </div>
            ),
          }} />}
        </div>
      </main>

      {insOpen && (
        <div className="ins-overlay" onClick={() => { setInsOpen(false); setHistOpen(false); }}>
          <div className="ins-modal" onClick={e => e.stopPropagation()}>
            <div className="ins-modal-head">
              <div className="ins-modal-title">
                {histOpen
                  ? <><History size={16} /> 思考历史</>
                  : <><span className="ins-emoji-lg">{insRun?.emoji}</span> {insRun?.name}</>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {!histOpen && <button className="ins-icon-btn" title="历史记录" onClick={() => setHistOpen(true)}><History size={15} /></button>}
                <button className="ins-icon-btn" title="关闭" onClick={() => { setInsOpen(false); setHistOpen(false); }}><X size={16} /></button>
              </div>
            </div>
            <div className="ins-modal-body">
              {histOpen ? (
                insHistory.length === 0
                  ? <div className="ins-empty">还没有思考记录</div>
                  : insHistory.map(h => (
                    <button key={h.id} className="ins-hist-item" onClick={() => { setInsRun(h); setHistOpen(false); }}>
                      <span className="ins-hist-emoji">{h.emoji}</span>
                      <span className="ins-hist-main">
                        <span className="ins-hist-name">{h.name}</span>
                        <span className="ins-hist-prev">{h.answer.replace(/\n/g, " ").slice(0, 64) || "（无内容）"}</span>
                      </span>
                      <span className="ins-hist-date">{new Date(h.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </button>
                  ))
              ) : (
                <>
                  <div className="ins-scope"><FileText size={11} /> 已综合你的全部笔记（{noteCount} 条）作为参考</div>
                  <div className="ins-answer">
                    {insRun?.answer ? <Markdown>{insRun.answer}</Markdown> : null}
                    {insLoading && <span className="ins-cursor" />}
                  </div>
                </>
              )}
            </div>
            {!histOpen && insRun?.answer && !insLoading && (
              <div className="ins-modal-foot">
                <button className="ins-foot-btn" onClick={() => navigator.clipboard?.writeText(insRun!.answer)}><Copy size={13} /> 复制</button>
                <button className="ins-foot-btn primary" onClick={() => {
                  try {
                    sessionStorage.setItem("ai_insight_continue", JSON.stringify({
                      prompt: insRun!.prompt, name: insRun!.name, emoji: insRun!.emoji, answer: insRun!.answer,
                    }));
                  } catch {}
                  router.push(`/chat?insight=1`);
                }}><MessageSquarePlus size={13} /> 在对话中继续</button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
    </div>
  );
}
