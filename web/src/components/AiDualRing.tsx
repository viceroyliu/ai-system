"use client";

/** 双环旋转图标：表示 AI 自动检索状态（区别于普通 loading） */
export default function AiDualRing({ size = 14 }: { size?: number }) {
  return <span className="ai-dual-ring" style={{ width: size, height: size }} aria-hidden="true" />;
}
