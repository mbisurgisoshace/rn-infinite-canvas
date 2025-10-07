// CanvasModule/hooks/useShapes.native.ts
import { useCallback, useRef, useState } from "react";

export type BaseShape = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number; // WORLD coords
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  text?: string;
};

export type RectShape = BaseShape & { kind: "rect" };
export type EllipseShape = BaseShape & { kind: "ellipse" };
export type TextShape = BaseShape & {
  kind: "text";
  fontSize?: number;
  color?: string;
};

export type Shape = RectShape | EllipseShape | TextShape;
export type Corner = "nw" | "ne" | "se" | "sw";

export function useShapes() {
  const [shapes, setShapes] = useState<Shape[]>([
    {
      id: "r1",
      kind: "rect",
      x: -120,
      y: -80,
      w: 160,
      h: 100,
      fill: "#EEF2FF",
      stroke: "#6376F1",
      strokeWidth: 2,
      text: "Rect",
    },
    {
      id: "e1",
      kind: "ellipse",
      x: 120,
      y: 40,
      w: 140,
      h: 90,
      fill: "#FFF7ED",
      stroke: "#F59E0B",
      strokeWidth: 2,
      text: "Ellipse",
    },
    {
      id: "t1",
      kind: "text",
      x: -40,
      y: 120,
      w: 220,
      h: 40,
      text: "Hello RN",
      fontSize: 18,
      color: "#111827",
    },
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Resize session
  const resizingRef = useRef<{ id: string | null; corner: Corner | null }>({
    id: null,
    corner: null,
  });
  const [isResizing, setIsResizing] = useState(false);

  const MIN_W = 20;
  const MIN_H = 20;

  // Selection
  const select = useCallback((id: string | null) => setSelectedId(id), []);

  // Drag move (incremental world deltas)
  const beginDrag = useCallback((id: string) => setDraggingId(id), []);
  const dragBy = useCallback(
    (dx: number, dy: number) => {
      if (!draggingId) return;
      setShapes((prev) =>
        prev.map((s) =>
          s.id === draggingId ? { ...s, x: s.x + dx, y: s.y + dy } : s
        )
      );
    },
    [draggingId]
  );
  const endDrag = useCallback(() => setDraggingId(null), []);

  // Add shapes
  const addRect = useCallback((partial: Partial<RectShape> = {}) => {
    const id = partial.id ?? `rect_${Math.random().toString(36).slice(2, 9)}`;
    const s: RectShape = {
      id,
      kind: "rect",
      x: partial.x ?? 0,
      y: partial.y ?? 0,
      w: partial.w ?? 160,
      h: partial.h ?? 100,
      fill: partial.fill ?? "#ffffff",
      stroke: partial.stroke ?? "#111111",
      strokeWidth: partial.strokeWidth ?? 2,
      text: partial.text ?? "Rect",
    };
    setShapes((prev) => [...prev, s]);
    return id;
  }, []);

  const addEllipse = useCallback((partial: Partial<EllipseShape> = {}) => {
    const id =
      partial.id ?? `ellipse_${Math.random().toString(36).slice(2, 9)}`;
    const s: EllipseShape = {
      id,
      kind: "ellipse",
      x: partial.x ?? 0,
      y: partial.y ?? 0,
      w: partial.w ?? 140,
      h: partial.h ?? 90,
      fill: partial.fill ?? "#ffffff",
      stroke: partial.stroke ?? "#111111",
      strokeWidth: partial.strokeWidth ?? 2,
      text: partial.text ?? "Ellipse",
    };
    setShapes((prev) => [...prev, s]);
    return id;
  }, []);

  const addText = useCallback((partial: Partial<TextShape> = {}) => {
    const id = partial.id ?? `text_${Math.random().toString(36).slice(2, 9)}`;
    const s: TextShape = {
      id,
      kind: "text",
      x: partial.x ?? 0,
      y: partial.y ?? 0,
      w: partial.w ?? 200,
      h: partial.h ?? 40,
      text: partial.text ?? "New text",
      fontSize: partial.fontSize ?? 18,
      color: partial.color ?? "#111827",
    };
    setShapes((prev) => [...prev, s]);
    return id;
  }, []);

  const setShapeText = useCallback((id: string, text: string) => {
    setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, text } : s)));
  }, []);

  // --- Resize API ---
  const beginResize = useCallback((id: string, corner: Corner) => {
    resizingRef.current = { id, corner };
    setIsResizing(true);
  }, []);

  /**
   * Apply INCREMENTAL world deltas to the CURRENT shape state, preserving opposite edges.
   * This avoids drift/jumpiness when the handle's view repositions during the gesture.
   */
  const resizeBy = useCallback((dx: number, dy: number) => {
    const sess = resizingRef.current;
    if (!sess.id || !sess.corner) return;

    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== sess.id) return s;

        let { x, y, w, h } = s;

        if (sess.corner === "se") {
          const newW = Math.max(MIN_W, w + dx);
          const newH = Math.max(MIN_H, h + dy);
          return { ...s, w: newW, h: newH };
        }

        if (sess.corner === "sw") {
          const right = x + w;
          const newW = Math.max(MIN_W, w - dx);
          const newX = right - newW;
          const newH = Math.max(MIN_H, h + dy);
          return { ...s, x: newX, w: newW, h: newH };
        }

        if (sess.corner === "ne") {
          const bottom = y + h;
          const newW = Math.max(MIN_W, w + dx);
          const newH = Math.max(MIN_H, h - dy);
          const newY = bottom - newH;
          return { ...s, y: newY, w: newW, h: newH };
        }

        // "nw"
        const right = x + w;
        const bottom = y + h;
        const newW = Math.max(MIN_W, w - dx);
        const newH = Math.max(MIN_H, h - dy);
        const newX = right - newW;
        const newY = bottom - newH;
        return { ...s, x: newX, y: newY, w: newW, h: newH };
      })
    );
  }, []);

  const endResize = useCallback(() => {
    resizingRef.current = { id: null, corner: null };
    setIsResizing(false);
  }, []);

  return {
    shapes,
    selectedId,
    select,
    beginDrag,
    dragBy,
    endDrag,
    addRect,
    addEllipse,
    addText,
    setShapeText,
    beginResize,
    resizeBy,
    endResize,
    isResizing,
  };
}
