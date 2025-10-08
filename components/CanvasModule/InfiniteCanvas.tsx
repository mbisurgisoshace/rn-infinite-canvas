// CanvasModule/InfiniteCanvas.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LayoutChangeEvent,
  Pressable,
  Text as RNText,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  LongPressGestureHandler,
  PanGestureHandler,
  PinchGestureHandler,
  State,
  TapGestureHandler,
} from "react-native-gesture-handler";
import { useShapes } from "./hooks/useShapes";

type Camera = { tx: number; ty: number; scale: number };

type Props = {
  backgroundColor?: string;
  gridSize?: number;
  majorEvery?: number;
  minorColor?: string;
  majorColor?: string;
};

const SEL_PAD = 6;
const TAP_SLOP = 8;

export default function InfiniteCanvas({
  backgroundColor = "#FFFFFF",
  gridSize = 32,
  majorEvery = 4,
  minorColor = "#EAECEE",
  majorColor = "#D0D5DA",
}: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState<Camera>({ tx: 0, ty: 0, scale: 1 });

  const {
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
  } = useShapes();

  // Inline text editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  // NEW: mode toggle (pan vs marquee select)
  const [selectMode, setSelectMode] = useState(false);

  // NEW: multi-select (visual for now)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // NEW: marquee selection state (screen-space)
  const [marquee, setMarquee] = useState<{
    active: boolean;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }>({ active: false, x0: 0, y0: 0, x1: 0, y1: 0 });

  // Canvas gesture refs
  const canvasPanRef = useRef<PanGestureHandler>(null);
  const canvasPinchRef = useRef<PinchGestureHandler>(null);
  const bgTapRef = useRef<TapGestureHandler>(null);
  const bgMarqueePanRef = useRef<PanGestureHandler>(null); // 1-finger drag when selectMode

  // Shape handler refs
  const shapePanRefs = useRef<Map<string, React.RefObject<PanGestureHandler>>>(
    new Map()
  );
  const shapeTapRefs = useRef<Map<string, React.RefObject<TapGestureHandler>>>(
    new Map()
  );
  const shapeDoubleTapRefs = useRef<
    Map<string, React.RefObject<TapGestureHandler>>
  >(new Map());

  // If the selected shape changes while resizing, end the resize session.
  useEffect(() => {
    endResize();
  }, [selectedId]); // harmless if not resizing

  useEffect(
    () => () => {
      endResize();
    },
    [endResize]
  ); // on unmount

  // Resize handle refs
  const handlePanRefs = useRef<Map<string, React.RefObject<PanGestureHandler>>>(
    new Map()
  );
  const registerHandleRef = useCallback(
    (id: string, ref: React.RefObject<PanGestureHandler>) => {
      handlePanRefs.current.set(id, ref);
    },
    []
  );
  const unregisterHandleRef = useCallback((id: string) => {
    handlePanRefs.current.delete(id);
  }, []);

  const registerShapePanRef = useCallback(
    (id: string, ref: React.RefObject<PanGestureHandler>) => {
      shapePanRefs.current.set(id, ref);
    },
    []
  );
  const unregisterShapePanRef = useCallback((id: string) => {
    shapePanRefs.current.delete(id);
  }, []);
  const registerShapeTapRef = useCallback(
    (id: string, ref: React.RefObject<TapGestureHandler>) => {
      shapeTapRefs.current.set(id, ref);
    },
    []
  );
  const unregisterShapeTapRef = useCallback((id: string) => {
    shapeTapRefs.current.delete(id);
  }, []);
  const registerShapeDoubleTapRef = useCallback(
    (id: string, ref: React.RefObject<TapGestureHandler>) => {
      shapeDoubleTapRefs.current.set(id, ref);
    },
    []
  );
  const unregisterShapeDoubleTapRef = useCallback((id: string) => {
    shapeDoubleTapRefs.current.delete(id);
  }, []);

  // Wait lists
  const handleWaitFor = useMemo(
    () => Array.from(handlePanRefs.current.values()),
    [selectedId, shapes.length]
  );
  const allInteractiveRefs = useMemo(
    () => [
      ...Array.from(shapeTapRefs.current.values()),
      ...Array.from(shapePanRefs.current.values()),
      ...Array.from(shapeDoubleTapRefs.current.values()),
      ...handleWaitFor,
    ],
    [handleWaitFor, shapes.length]
  );

  // Canvas PAN (legacy)
  const panStart = useRef({ tx: 0, ty: 0 });
  const onCanvasPanState = useCallback(
    (e: any) => {
      if (e.nativeEvent.state === State.ACTIVE) {
        panStart.current = { tx: cam.tx, ty: cam.ty };
      }
    },
    [cam.tx, cam.ty]
  );
  const onCanvasPanEvent = useCallback((e: any) => {
    const { translationX, translationY } = e.nativeEvent ?? {};
    if (!Number.isFinite(translationX) || !Number.isFinite(translationY))
      return;
    setCam((c) => ({
      ...c,
      tx: panStart.current.tx + translationX,
      ty: panStart.current.ty + translationY,
    }));
  }, []);

  // Canvas PINCH (legacy)
  const pinchStart = useRef({ scale: 1 });
  const onCanvasPinchState = useCallback(
    (e: any) => {
      if (e.nativeEvent.state === State.ACTIVE) {
        pinchStart.current = { scale: cam.scale };
      }
    },
    [cam.scale]
  );
  const onCanvasPinchEvent = useCallback((e: any) => {
    const { scale } = e.nativeEvent ?? {};
    if (!Number.isFinite(scale)) return;
    const next = pinchStart.current.scale * scale;
    const clamped = Math.max(0.2, Math.min(5, next));
    setCam((c) => ({ ...c, scale: clamped }));
  }, []);

  // Background tap → deselect / end edit / clear multi
  const onBackgroundTap = useCallback(
    (e: any) => {
      if (e.nativeEvent.state === State.END) {
        endResize();
        select(null);
        setEditingId(null);
        if (selectedIds.size) setSelectedIds(new Set());
      }
    },
    [select, endResize, selectedIds.size]
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width && height) setSize({ w: width, h: height });
  }, []);

  // Toolbar actions
  const handleAddRect = useCallback(() => {
    const id = addRect({
      x: 0,
      y: 0,
      w: 160,
      h: 100,
      fill: "#F5F9FF",
      stroke: "#2563EB",
    });
    select(id);
    setSelectedIds(new Set());
  }, [addRect, select]);
  const handleAddEllipse = useCallback(() => {
    const id = addEllipse({
      x: 0,
      y: 0,
      w: 140,
      h: 90,
      fill: "#FFF7ED",
      stroke: "#F59E0B",
    });
    select(id);
    setSelectedIds(new Set());
  }, [addEllipse, select]);
  const handleAddText = useCallback(() => {
    const id = addText({
      x: 0,
      y: 0,
      text: "New text",
      w: 200,
      h: 40,
      fontSize: 18,
      color: "#111827",
    });
    select(id);
    setSelectedIds(new Set());
  }, [addText, select]);

  // Text editing
  const beginEditing = useCallback((id: string) => {
    setEditingId(id);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);
  const fontSizeFor = useCallback(
    (s: { fontSize?: number }) => (s.fontSize ?? 16) * cam.scale,
    [cam.scale]
  );

  // ---- Marquee with one-finger drag ONLY when selectMode === true
  const onBgMarqueePanState = useCallback(
    (e: any) => {
      const { state, absoluteX, absoluteY } = e.nativeEvent ?? {};
      if (!selectMode) return;

      if (state === State.BEGAN) {
        // start marquee
        setEditingId(null);
        endResize();
        select(null);
        setSelectedIds(new Set());
        setMarquee({
          active: true,
          x0: absoluteX,
          y0: absoluteY,
          x1: absoluteX,
          y1: absoluteY,
        });
      } else if (
        state === State.END ||
        state === State.CANCELLED ||
        state === State.FAILED
      ) {
        // finish and compute selection
        setMarquee((m) => {
          if (!m.active) return m;
          const xMin = Math.min(m.x0, m.x1);
          const yMin = Math.min(m.y0, m.y1);
          const xMax = Math.max(m.x0, m.x1);
          const yMax = Math.max(m.y0, m.y1);

          const inside = new Set<string>();
          for (const sh of shapes) {
            const sx = sh.x * cam.scale + cam.tx;
            const sy = sh.y * cam.scale + cam.ty;
            const sw = sh.w * cam.scale;
            const shh = sh.h * cam.scale;
            const sRight = sx + sw;
            const sBottom = sy + shh;
            const fullyInside =
              sx >= xMin && sRight <= xMax && sy >= yMin && sBottom <= yMax;
            if (fullyInside) inside.add(sh.id);
          }
          setSelectedIds(inside);
          return { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };
        });
      }
    },
    [selectMode, shapes, cam.scale, cam.tx, cam.ty, endResize, select]
  );

  const onBgMarqueePanEvent = useCallback(
    (e: any) => {
      if (!selectMode) return;
      const { absoluteX, absoluteY } = e.nativeEvent ?? {};
      if (!Number.isFinite(absoluteX) || !Number.isFinite(absoluteY)) return;
      setMarquee((m) =>
        m.active ? { ...m, x1: absoluteX, y1: absoluteY } : m
      );
    },
    [selectMode]
  );

  // Disable canvas one-finger pan while selecting; keep pinch in both modes
  const canvasPanEnabled = !isResizing && !selectMode && !marquee.active;

  return (
    <PinchGestureHandler
      ref={canvasPinchRef}
      onGestureEvent={onCanvasPinchEvent}
      onHandlerStateChange={onCanvasPinchState}
      enabled={!isResizing}
    >
      <View style={styles.flex}>
        <PanGestureHandler
          ref={canvasPanRef}
          onGestureEvent={onCanvasPanEvent}
          onHandlerStateChange={onCanvasPanState}
          minPointers={1}
          maxPointers={2}
          waitFor={handleWaitFor}
          enabled={canvasPanEnabled}
        >
          {/* When selectMode is ON, this 1-finger PAN draws the marquee */}
          <PanGestureHandler
            ref={bgMarqueePanRef}
            onHandlerStateChange={onBgMarqueePanState}
            onGestureEvent={onBgMarqueePanEvent}
            minPointers={1}
            maxPointers={1}
            enabled={selectMode && !isResizing}
          >
            <TapGestureHandler
              ref={bgTapRef}
              onHandlerStateChange={onBackgroundTap}
              maxDist={TAP_SLOP}
              simultaneousHandlers={[
                canvasPanRef,
                canvasPinchRef,
                bgMarqueePanRef,
              ]}
              waitFor={allInteractiveRefs}
            >
              <View
                style={[styles.flex, { backgroundColor }]}
                onLayout={onLayout}
              >
                {/* SHAPES (with inline TextInput) */}
                {shapes.map((s) => {
                  const sx = s.x * cam.scale + cam.tx;
                  const sy = s.y * cam.scale + cam.ty;
                  const sw = s.w * cam.scale;
                  const sh = s.h * cam.scale;
                  const isThisEditing = editingId === s.id;

                  if (s.kind === "rect") {
                    const fs = fontSizeFor(s);
                    return (
                      <View
                        key={s.id}
                        style={{
                          position: "absolute",
                          left: sx,
                          top: sy,
                          width: sw,
                          height: sh,
                          backgroundColor: s.fill ?? "#fff",
                          borderColor: s.stroke ?? "#111",
                          borderWidth: s.strokeWidth ?? 2,
                          justifyContent: "flex-start",
                          padding: 8,
                          zIndex: isThisEditing ? 1000 : 0,
                        }}
                      >
                        <TextInput
                          ref={isThisEditing ? inputRef : undefined}
                          value={s.text ?? ""}
                          onChangeText={(t) => setShapeText(s.id, t)}
                          editable={isThisEditing}
                          autoFocus={isThisEditing}
                          selectTextOnFocus
                          blurOnSubmit
                          onBlur={() => setEditingId(null)}
                          onSubmitEditing={() => setEditingId(null)}
                          underlineColorAndroid="transparent"
                          selectionColor="#3B82F6"
                          placeholder=""
                          style={{
                            fontSize: fs,
                            color: s.color ?? "#111",
                            padding: 0,
                            margin: 0,
                            backgroundColor: "transparent",
                            width: "100%",
                          }}
                        />
                      </View>
                    );
                  }

                  if (s.kind === "ellipse") {
                    const fs = fontSizeFor(s);
                    return (
                      <View
                        key={s.id}
                        style={{
                          position: "absolute",
                          left: sx,
                          top: sy,
                          width: sw,
                          height: sh,
                          backgroundColor: s.fill ?? "#fff",
                          borderColor: s.stroke ?? "#111",
                          borderWidth: s.strokeWidth ?? 2,
                          borderRadius: Math.min(sw, sh) / 2,
                          justifyContent: "center",
                          alignItems: "center",
                          overflow: "hidden",
                          zIndex: isThisEditing ? 1000 : 0,
                        }}
                      >
                        <TextInput
                          ref={isThisEditing ? inputRef : undefined}
                          value={s.text ?? ""}
                          onChangeText={(t) => setShapeText(s.id, t)}
                          editable={isThisEditing}
                          autoFocus={isThisEditing}
                          selectTextOnFocus
                          blurOnSubmit
                          onBlur={() => setEditingId(null)}
                          onSubmitEditing={() => setEditingId(null)}
                          underlineColorAndroid="transparent"
                          selectionColor="#3B82F6"
                          placeholder=""
                          style={{
                            fontSize: fs,
                            color: s.color ?? "#111",
                            padding: 0,
                            margin: 0,
                            backgroundColor: "transparent",
                            width: "100%",
                            textAlign: "center",
                          }}
                        />
                      </View>
                    );
                  }

                  if (s.kind === "text") {
                    const fs = (s.fontSize ?? 18) * cam.scale;
                    return (
                      <View
                        key={s.id}
                        style={{
                          position: "absolute",
                          left: sx,
                          top: sy,
                          width: sw,
                          height: sh,
                          justifyContent: "flex-start",
                          zIndex: isThisEditing ? 1000 : 0,
                        }}
                      >
                        <TextInput
                          ref={isThisEditing ? inputRef : undefined}
                          value={s.text ?? ""}
                          onChangeText={(t) => setShapeText(s.id, t)}
                          editable={isThisEditing}
                          autoFocus={isThisEditing}
                          selectTextOnFocus
                          blurOnSubmit
                          onBlur={() => setEditingId(null)}
                          onSubmitEditing={() => setEditingId(null)}
                          underlineColorAndroid="transparent"
                          selectionColor="#3B82F6"
                          placeholder=""
                          style={{
                            fontSize: fs,
                            color: s.color ?? "#111",
                            padding: 0,
                            margin: 0,
                            backgroundColor: "transparent",
                            width: "100%",
                            height: "100%",
                          }}
                        />
                      </View>
                    );
                  }
                  return null;
                })}

                {/* SELECTION OUTLINES (single + multi). Hide when editing that shape */}
                {shapes.map((s) => {
                  const isSingle = s.id === selectedId && editingId !== s.id;
                  const isMulti =
                    selectedIds.has(s.id) &&
                    s.id !== selectedId &&
                    editingId !== s.id;
                  if (!isSingle && !isMulti) return null;

                  const sx = s.x * cam.scale + cam.tx;
                  const sy = s.y * cam.scale + cam.ty;
                  const sw = s.w * cam.scale;
                  const sh = s.h * cam.scale;

                  return (
                    <View
                      key={`sel-${s.id}`}
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        left: sx - SEL_PAD,
                        top: sy - SEL_PAD,
                        width: sw + SEL_PAD * 2,
                        height: sh + SEL_PAD * 2,
                        borderColor: "#3B82F6",
                        borderWidth: 2,
                      }}
                    />
                  );
                })}

                {/* Handles for single selection only (unchanged) */}
                {shapes.map((s) => {
                  if (s.id !== selectedId || editingId === s.id) return null;
                  const sx = s.x * cam.scale + cam.tx;
                  const sy = s.y * cam.scale + cam.ty;
                  const sw = s.w * cam.scale;
                  const sh = s.h * cam.scale;

                  return (
                    <React.Fragment key={`handles-${s.id}`}>
                      <ResizeHandle
                        cx={sx}
                        cy={sy}
                        corner="nw"
                        camScale={cam.scale}
                        shapeId={s.id}
                        beginResize={beginResize}
                        resizeBy={resizeBy}
                        endResize={endResize}
                        registerHandleRef={registerHandleRef}
                        unregisterHandleRef={unregisterHandleRef}
                      />
                      <ResizeHandle
                        cx={sx + sw}
                        cy={sy}
                        corner="ne"
                        camScale={cam.scale}
                        shapeId={s.id}
                        beginResize={beginResize}
                        resizeBy={resizeBy}
                        endResize={endResize}
                        registerHandleRef={registerHandleRef}
                        unregisterHandleRef={unregisterHandleRef}
                      />
                      <ResizeHandle
                        cx={sx + sw}
                        cy={sy + sh}
                        corner="se"
                        camScale={cam.scale}
                        shapeId={s.id}
                        beginResize={beginResize}
                        resizeBy={resizeBy}
                        endResize={endResize}
                        registerHandleRef={registerHandleRef}
                        unregisterHandleRef={unregisterHandleRef}
                      />
                      <ResizeHandle
                        cx={sx}
                        cy={sy + sh}
                        corner="sw"
                        camScale={cam.scale}
                        shapeId={s.id}
                        beginResize={beginResize}
                        resizeBy={resizeBy}
                        endResize={endResize}
                        registerHandleRef={registerHandleRef}
                        unregisterHandleRef={unregisterHandleRef}
                      />
                    </React.Fragment>
                  );
                })}

                {/* Interaction overlays (tap/select + drag + long-press to edit for ALL shapes) */}
                {shapes.map((s) => {
                  const sx = s.x * cam.scale + cam.tx;
                  const sy = s.y * cam.scale + cam.ty;
                  const sw = s.w * cam.scale;
                  const sh = s.h * cam.scale;
                  const isEditingThis = editingId === s.id;

                  return (
                    <ShapeOverlay
                      key={`ovl-${s.id}`}
                      id={s.id}
                      left={sx}
                      top={sy}
                      width={sw}
                      height={sh}
                      select={(id) => {
                        setSelectedIds(new Set());
                        select(id);
                      }}
                      beginDrag={beginDrag}
                      dragByWorld={dragBy}
                      endDrag={endDrag}
                      camScale={cam.scale}
                      onEdit={() => {
                        setSelectedIds(new Set());
                        select(s.id);
                        beginEditing(s.id);
                      }}
                      canEditText={true}
                      registerShapePanRef={(id, ref) =>
                        shapePanRefs.current.set(id, ref)
                      }
                      unregisterShapePanRef={(id) =>
                        shapePanRefs.current.delete(id)
                      }
                      registerShapeTapRef={(id, ref) =>
                        shapeTapRefs.current.set(id, ref)
                      }
                      unregisterShapeTapRef={(id) =>
                        shapeTapRefs.current.delete(id)
                      }
                      registerShapeDoubleTapRef={(id, ref) =>
                        shapeDoubleTapRefs.current.set(id, ref)
                      }
                      unregisterShapeDoubleTapRef={(id) =>
                        shapeDoubleTapRefs.current.delete(id)
                      }
                      handleWaitFor={Array.from(handlePanRefs.current.values())}
                      isResizing={isResizing}
                      isEditingThis={isEditingThis}
                    />
                  );
                })}

                {/* Marquee rectangle overlay */}
                {marquee.active && (
                  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    {(() => {
                      const x = Math.min(marquee.x0, marquee.x1);
                      const y = Math.min(marquee.y0, marquee.y1);
                      const w = Math.abs(marquee.x1 - marquee.x0);
                      const h = Math.abs(marquee.y1 - marquee.y0);
                      return (
                        <View
                          style={{
                            position: "absolute",
                            left: x,
                            top: y,
                            width: w,
                            height: h,
                            borderWidth: 2,
                            borderColor: "#3B82F6",
                            backgroundColor: "rgba(59,130,246,0.12)",
                          }}
                        />
                      );
                    })()}
                  </View>
                )}
              </View>
            </TapGestureHandler>
          </PanGestureHandler>
        </PanGestureHandler>

        {/* Toolbar */}
        <View pointerEvents="box-none" style={styles.toolbarWrap}>
          <View style={styles.toolbar}>
            <ToolbarButton label="Rect" onPress={handleAddRect} />
            <ToolbarButton label="Ellipse" onPress={handleAddEllipse} />
            <ToolbarButton label="Text" onPress={handleAddText} />
            {/* Mode toggle */}
            <Pressable
              onPress={() => setSelectMode((m) => !m)}
              style={({ pressed }) => [
                styles.btn,
                pressed && styles.btnPressed,
                selectMode && {
                  backgroundColor: "#DBEAFE",
                  borderColor: "#93C5FD",
                },
              ]}
            >
              <RNText
                style={[styles.btnText, selectMode && { color: "#1D4ED8" }]}
              >
                {selectMode ? "Selecting…" : "Select"}
              </RNText>
            </Pressable>
          </View>
        </View>
      </View>
    </PinchGestureHandler>
  );
}

function ToolbarButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
    >
      <RNText style={styles.btnText}>{label}</RNText>
    </Pressable>
  );
}

/** Corner resize handle with absolute finger deltas. */
function ResizeHandle({
  cx,
  cy,
  corner,
  camScale,
  shapeId,
  beginResize,
  resizeBy,
  endResize,
  registerHandleRef,
  unregisterHandleRef,
}: {
  cx: number;
  cy: number;
  corner: "nw" | "ne" | "se" | "sw";
  camScale: number;
  shapeId: string;
  beginResize: (id: string, corner: "nw" | "ne" | "se" | "sw") => void;
  resizeBy: (dxWorld: number, dyWorld: number) => void;
  endResize: () => void;
  registerHandleRef: (
    id: string,
    ref: React.RefObject<PanGestureHandler>
  ) => void;
  unregisterHandleRef: (id: string) => void;
}) {
  const panRef = useRef<PanGestureHandler>(null);
  const lastAbs = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const key = `${shapeId}:${corner}`;
    registerHandleRef(key, panRef);
    return () => unregisterHandleRef(key);
  }, [shapeId, corner, registerHandleRef, unregisterHandleRef]);

  const onState = useCallback(
    (e: any) => {
      const { state, absoluteX, absoluteY } = e.nativeEvent ?? {};
      if (state === State.BEGAN) {
        lastAbs.current = { x: absoluteX, y: absoluteY };
        beginResize(shapeId, corner);
      }
      if (
        state === State.END ||
        state === State.CANCELLED ||
        state === State.FAILED
      ) {
        lastAbs.current = null;
        endResize();
      }
    },
    [beginResize, endResize, shapeId, corner]
  );

  const onPan = useCallback(
    (e: any) => {
      const { absoluteX, absoluteY, state } = e.nativeEvent ?? {};
      if (!Number.isFinite(absoluteX) || !Number.isFinite(absoluteY)) return;
      if (!lastAbs.current) {
        lastAbs.current = { x: absoluteX, y: absoluteY };
        return;
      }
      const dxIncScreen = absoluteX - lastAbs.current.x;
      const dyIncScreen = absoluteY - lastAbs.current.y;
      lastAbs.current = { x: absoluteX, y: absoluteY };
      if (dxIncScreen !== 0 || dyIncScreen !== 0) {
        resizeBy(dxIncScreen / camScale, dyIncScreen / camScale); // screen → world
      }
      if (
        state === State.END ||
        state === State.CANCELLED ||
        state === State.FAILED
      ) {
        lastAbs.current = null;
        endResize();
      }
    },
    [camScale, resizeBy, endResize]
  );

  const SIZE = 16;
  const HIT = 28;

  return (
    <PanGestureHandler
      ref={panRef}
      onHandlerStateChange={onState}
      onGestureEvent={onPan}
      minPointers={1}
      maxPointers={1}
      activeOffsetX={[-3, 3]}
      activeOffsetY={[-3, 3]}
      shouldCancelWhenOutside={false}
      hitSlop={12}
    >
      <View
        style={{
          position: "absolute",
          left: cx - HIT / 2,
          top: cy - HIT / 2,
          width: HIT,
          height: HIT,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View
          pointerEvents="none"
          style={{
            width: SIZE,
            height: SIZE,
            borderRadius: 4,
            backgroundColor: "#3B82F6",
            borderWidth: 2,
            borderColor: "#fff",
          }}
        />
      </View>
    </PanGestureHandler>
  );
}

/** One overlay per shape: tap (select), long-press (edit), pan (drag). */
function ShapeOverlay(props: {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number; // screen-space
  select: (id: string | null) => void;
  beginDrag: (id: string) => void;
  dragByWorld: (dxWorld: number, dyWorld: number) => void;
  endDrag: () => void;
  camScale: number;
  onEdit: () => void; // enter inline edit
  canEditText: boolean;
  registerShapePanRef: (
    id: string,
    ref: React.RefObject<PanGestureHandler>
  ) => void;
  unregisterShapePanRef: (id: string) => void;
  registerShapeTapRef: (
    id: string,
    ref: React.RefObject<TapGestureHandler>
  ) => void;
  unregisterShapeTapRef: (id: string) => void;
  registerShapeDoubleTapRef: (
    id: string,
    ref: React.RefObject<TapGestureHandler>
  ) => void;
  unregisterShapeDoubleTapRef: (id: string) => void;
  handleWaitFor: React.RefObject<any>[];
  isResizing: boolean;
  isEditingThis: boolean;
}) {
  const {
    id,
    left,
    top,
    width,
    height,
    select,
    beginDrag,
    dragByWorld,
    endDrag,
    camScale,
    onEdit,
    canEditText,
    registerShapePanRef,
    unregisterShapePanRef,
    registerShapeTapRef,
    unregisterShapeTapRef,
    registerShapeDoubleTapRef,
    unregisterShapeDoubleTapRef,
    handleWaitFor,
    isResizing,
    isEditingThis,
  } = props;

  const shapePanRef = useRef<PanGestureHandler>(null);
  const shapeTapRef = useRef<TapGestureHandler>(null);
  const shapeLongPressRef = useRef<LongPressGestureHandler>(null);

  useEffect(() => {
    registerShapePanRef(id, shapePanRef);
    registerShapeTapRef(id, shapeTapRef);
    registerShapeDoubleTapRef(id, { current: null } as any); // keep structure
    return () => {
      unregisterShapePanRef(id);
      unregisterShapeTapRef(id);
      unregisterShapeDoubleTapRef(id);
    };
  }, [
    id,
    registerShapePanRef,
    registerShapeTapRef,
    registerShapeDoubleTapRef,
    unregisterShapePanRef,
    unregisterShapeTapRef,
    unregisterShapeDoubleTapRef,
  ]);

  const last = useRef({ x: 0, y: 0 });
  const didDrag = useRef(false);
  const onPanState = useCallback(
    (e: any) => {
      const st = e.nativeEvent.state;
      if (st === State.BEGAN) {
        didDrag.current = false;
        last.current = { x: 0, y: 0 };
        select(id);
        beginDrag(id);
      }
      if (st === State.END || st === State.CANCELLED || st === State.FAILED) {
        endDrag();
      }
    },
    [id, select, beginDrag, endDrag]
  );

  const onPan = useCallback(
    (e: any) => {
      const { translationX, translationY } = e.nativeEvent ?? {};
      if (!Number.isFinite(translationX) || !Number.isFinite(translationY))
        return;
      const dxInc = translationX - last.current.x;
      const dyInc = translationY - last.current.y;
      last.current = { x: translationX, y: translationY };
      if (!didDrag.current) {
        if (
          Math.abs(translationX) > TAP_SLOP ||
          Math.abs(translationY) > TAP_SLOP
        )
          didDrag.current = true;
        else return;
      }
      dragByWorld(dxInc / camScale, dyInc / camScale); // screen → world
    },
    [camScale, dragByWorld]
  );

  const onSingleTapActivated = useCallback(() => {
    select(id);
  }, [id, select]);

  return (
    <View
      style={[stylesShape.hit, { left, top, width, height }]}
      pointerEvents={isEditingThis ? "none" : "auto"} // allow TextInput while editing
    >
      {/* Long-press to edit (any shape) */}
      <LongPressGestureHandler
        ref={shapeLongPressRef}
        minDurationMs={280}
        maxDist={12}
        onActivated={() => {
          if (canEditText) onEdit();
        }}
        simultaneousHandlers={[shapePanRef]}
        enabled={!isResizing}
      >
        <View style={StyleSheet.absoluteFill}>
          {/* Single tap to select (waits for pan & long-press) */}
          <TapGestureHandler
            ref={shapeTapRef}
            waitFor={[shapePanRef, shapeLongPressRef, ...handleWaitFor]}
            maxDist={TAP_SLOP}
            onActivated={onSingleTapActivated}
            enabled={!isResizing}
          >
            <View style={StyleSheet.absoluteFill}>
              {/* Pan to drag */}
              <PanGestureHandler
                ref={shapePanRef}
                onHandlerStateChange={onPanState}
                onGestureEvent={onPan}
                minPointers={1}
                maxPointers={1}
                shouldCancelWhenOutside={false}
                waitFor={handleWaitFor}
                activeOffsetX={[-3, 3]}
                activeOffsetY={[-3, 3]}
                enabled={!isResizing}
              >
                <View style={StyleSheet.absoluteFill} />
              </PanGestureHandler>
            </View>
          </TapGestureHandler>
        </View>
      </LongPressGestureHandler>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  toolbarWrap: {
    position: "absolute",
    bottom: 24,
    left: 0,
    right: 0,
    alignItems: "center",
    pointerEvents: "box-none",
  },
  toolbar: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  btnPressed: { opacity: 0.7 },
  btnText: { color: "#111827", fontWeight: "600" },
});
const stylesShape = StyleSheet.create({
  hit: { position: "absolute", backgroundColor: "transparent" },
});
