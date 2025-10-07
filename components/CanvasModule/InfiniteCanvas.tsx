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
  } = useShapes();

  // Inline text editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const inputRef = useRef<TextInput>(null);

  // Canvas gesture refs
  const canvasPanRef = useRef<PanGestureHandler>(null);
  const canvasPinchRef = useRef<PinchGestureHandler>(null);
  const bgTapRef = useRef<TapGestureHandler>(null);

  // Shape handler refs so background tap can wait for them
  const shapePanRefs = useRef<Map<string, React.RefObject<PanGestureHandler>>>(
    new Map()
  );
  const shapeTapRefs = useRef<Map<string, React.RefObject<TapGestureHandler>>>(
    new Map()
  );
  const shapeDoubleTapRefs = useRef<
    Map<string, React.RefObject<TapGestureHandler>>
  >(new Map());

  // Resize handle pan refs (so they can win gesture races)
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
      const st = e.nativeEvent.state;
      if (st === State.ACTIVE) {
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

  // Background tap → deselect
  const onBackgroundTap = useCallback(
    (e: any) => {
      if (e.nativeEvent.state === State.END) {
        select(null);
        setEditingId(null);
      }
    },
    [select]
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width && height) setSize({ w: width, h: height });
  }, []);

  // Grid as Views (screen space)
  const gridViews = useMemo(() => {
    const nodes: JSX.Element[] = [];
    if (size.w <= 0 || size.h <= 0 || gridSize <= 0) return nodes;

    const step = gridSize * cam.scale;
    if (!(step > 0.001) || !isFinite(step)) return nodes;

    const startX = ((-cam.tx % step) + step) % step;
    const startY = ((-cam.ty % step) + step) % step;
    const countX = Math.ceil((size.w - startX) / step) + 1;
    const countY = Math.ceil((size.h - startY) / step) + 1;

    for (let i = -1; i <= countX; i++) {
      const x = startX + i * step;
      const idx = Math.round((x - cam.tx) / step);
      const major = majorEvery > 0 && idx % majorEvery === 0;
      nodes.push(
        <View
          key={`vx-${i}`}
          style={{
            position: "absolute",
            left: Math.round(x),
            top: 0,
            width: 1,
            height: size.h,
            backgroundColor: major ? majorColor : minorColor,
          }}
        />
      );
    }
    for (let j = -1; j <= countY; j++) {
      const y = startY + j * step;
      const idx = Math.round((y - cam.ty) / step);
      const major = majorEvery > 0 && idx % majorEvery === 0;
      nodes.push(
        <View
          key={`hy-${j}`}
          style={{
            position: "absolute",
            left: 0,
            top: Math.round(y),
            height: 1,
            width: size.w,
            backgroundColor: major ? majorColor : minorColor,
          }}
        />
      );
    }
    return nodes;
  }, [
    size.w,
    size.h,
    gridSize,
    majorEvery,
    cam.scale,
    cam.tx,
    cam.ty,
    minorColor,
    majorColor,
  ]);

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
  }, [addText, select]);

  // Helpers: screen frame of a shape
  const getScreenFrame = useCallback(
    (id: string) => {
      const s = shapes.find((sh) => sh.id === id);
      if (!s) return null;
      const sx = s.x * cam.scale + cam.tx;
      const sy = s.y * cam.scale + cam.ty;
      const sw = s.w * cam.scale;
      const sh = s.h * cam.scale;
      return { sx, sy, sw, sh, shape: s };
    },
    [shapes, cam.scale, cam.tx, cam.ty]
  );

  const beginEditing = useCallback(
    (id: string) => {
      const fr = getScreenFrame(id);
      if (!fr) return;
      const initial = fr.shape.text ?? "";
      setEditingId(id);
      setEditingValue(initial);
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [getScreenFrame]
  );

  const commitEditing = useCallback(() => {
    if (editingId !== null) setShapeText(editingId, editingValue);
    setEditingId(null);
  }, [editingId, editingValue, setShapeText]);

  return (
    <PinchGestureHandler
      ref={canvasPinchRef}
      onGestureEvent={onCanvasPinchEvent}
      onHandlerStateChange={onCanvasPinchState}
    >
      <View style={styles.flex}>
        <PanGestureHandler
          ref={canvasPanRef}
          onGestureEvent={onCanvasPanEvent}
          onHandlerStateChange={onCanvasPanState}
          minPointers={1}
          maxPointers={2}
          waitFor={handleWaitFor} // canvas pan waits for handles
        >
          <TapGestureHandler
            ref={bgTapRef}
            onHandlerStateChange={onBackgroundTap}
            maxDist={TAP_SLOP}
            simultaneousHandlers={[canvasPanRef, canvasPinchRef]}
            waitFor={allInteractiveRefs} // bg tap waits for shapes + handles
          >
            <View
              style={[styles.flex, { backgroundColor }]}
              onLayout={onLayout}
            >
              {/* GRID (screen space) */}
              {/* <View style={StyleSheet.absoluteFill}>{gridViews}</View> */}

              {/* SHAPES (screen space) */}
              {shapes.map((s) => {
                const sx = s.x * cam.scale + cam.tx;
                const sy = s.y * cam.scale + cam.ty;
                const sw = s.w * cam.scale;
                const sh = s.h * cam.scale;

                if (s.kind === "rect") {
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
                      }}
                    >
                      {!!s.text && (
                        <RNText
                          style={{
                            margin: 8,
                            fontSize: 16 * cam.scale,
                            color: "#111",
                          }}
                        >
                          {s.text}
                        </RNText>
                      )}
                    </View>
                  );
                }

                if (s.kind === "ellipse") {
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
                      }}
                    >
                      {!!s.text && (
                        <RNText
                          style={{ fontSize: 16 * cam.scale, color: "#111" }}
                        >
                          {s.text}
                        </RNText>
                      )}
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
                      }}
                    >
                      <RNText
                        style={{ fontSize: fs, color: s.color ?? "#111" }}
                      >
                        {s.text ?? ""}
                      </RNText>
                    </View>
                  );
                }

                return null;
              })}

              {/* SELECTION + HANDLES (screen space) */}
              {shapes.map((s) => {
                if (s.id !== selectedId) return null;
                const sx = s.x * cam.scale + cam.tx;
                const sy = s.y * cam.scale + cam.ty;
                const sw = s.w * cam.scale;
                const sh = s.h * cam.scale;

                return (
                  <React.Fragment key={`sel-${s.id}`}>
                    <View
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
                    {/* Corner handles */}
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

              {/* Interaction overlays (screen space) */}
              {shapes.map((s) => {
                const sx = s.x * cam.scale + cam.tx;
                const sy = s.y * cam.scale + cam.ty;
                const sw = s.w * cam.scale;
                const sh = s.h * cam.scale;

                return (
                  <ShapeOverlay
                    key={`ovl-${s.id}`}
                    id={s.id}
                    left={sx}
                    top={sy}
                    width={sw}
                    height={sh}
                    select={select}
                    beginDrag={beginDrag}
                    dragByWorld={dragBy}
                    endDrag={endDrag}
                    camScale={cam.scale}
                    onDoubleTap={() => {
                      select(s.id);
                      beginEditing(s.id);
                    }}
                    registerShapePanRef={registerShapePanRef}
                    unregisterShapePanRef={unregisterShapePanRef}
                    registerShapeTapRef={registerShapeTapRef}
                    unregisterShapeTapRef={unregisterShapeTapRef}
                    registerShapeDoubleTapRef={registerShapeDoubleTapRef}
                    unregisterShapeDoubleTapRef={unregisterShapeDoubleTapRef}
                    handleWaitFor={handleWaitFor} // <-- pass down
                  />
                );
              })}

              {/* TEXT EDITOR overlay (screen space) */}
              {editingId &&
                (() => {
                  const fr = getScreenFrame(editingId);
                  if (!fr) return null;
                  const { sx, sy, sw, sh } = fr;
                  return (
                    <View
                      style={[
                        styles.editorWrap,
                        {
                          left: sx + 2,
                          top: sy + 2,
                          width: Math.max(60, sw - 4),
                        },
                      ]}
                    >
                      <TextInput
                        ref={inputRef}
                        value={editingValue}
                        onChangeText={setEditingValue}
                        onBlur={commitEditing}
                        onSubmitEditing={commitEditing}
                        placeholder="Type…"
                        style={styles.editorInput}
                        multiline
                        numberOfLines={Math.max(1, Math.round(sh / 20))}
                        returnKeyType="done"
                      />
                    </View>
                  );
                })()}
            </View>
          </TapGestureHandler>
        </PanGestureHandler>

        {/* Floating Toolbar bottom-center */}
        <View pointerEvents="box-none" style={styles.toolbarWrap}>
          <View style={styles.toolbar}>
            <ToolbarButton label="Rect" onPress={handleAddRect} />
            <ToolbarButton label="Ellipse" onPress={handleAddEllipse} />
            <ToolbarButton label="Text" onPress={handleAddText} />
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

/** Corner resize handle (screen space). */
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
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const key = `${shapeId}:${corner}`;
    registerHandleRef(key, panRef);
    return () => unregisterHandleRef(key);
  }, [shapeId, corner, registerHandleRef, unregisterHandleRef]);

  const onState = useCallback(
    (e: any) => {
      const st = e.nativeEvent.state;
      if (st === State.BEGAN) {
        last.current = { x: 0, y: 0 };
        beginResize(shapeId, corner);
      }
      if (st === State.END || st === State.CANCELLED || st === State.FAILED) {
        endResize();
      }
    },
    [beginResize, endResize, shapeId, corner]
  );

  const onPan = useCallback(
    (e: any) => {
      const { translationX, translationY } = e.nativeEvent ?? {};
      if (!Number.isFinite(translationX) || !Number.isFinite(translationY))
        return;
      const dxInc = translationX - last.current.x;
      const dyInc = translationY - last.current.y;
      last.current = { x: translationX, y: translationY };
      resizeBy(dxInc / camScale, dyInc / camScale); // screen → world
    },
    [camScale, resizeBy]
  );

  const SIZE = 16; // visual size
  const HIT = 28; // touch target

  return (
    <PanGestureHandler
      ref={panRef}
      onHandlerStateChange={onState}
      onGestureEvent={onPan}
      minPointers={1}
      maxPointers={1}
      activeOffsetX={[-3, 3]}
      activeOffsetY={[-3, 3]}
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

/** One overlay per shape: tap (select), double-tap (edit), pan (drag). */
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
  onDoubleTap: () => void;
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
  handleWaitFor: React.RefObject<any>[]; // <-- NEW
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
    onDoubleTap,
    registerShapePanRef,
    unregisterShapePanRef,
    registerShapeTapRef,
    unregisterShapeTapRef,
    registerShapeDoubleTapRef,
    unregisterShapeDoubleTapRef,
    handleWaitFor,
  } = props;

  const shapePanRef = useRef<PanGestureHandler>(null);
  const shapeTapRef = useRef<TapGestureHandler>(null);
  const shapeDoubleTapRef = useRef<TapGestureHandler>(null);

  useEffect(() => {
    registerShapePanRef(id, shapePanRef);
    registerShapeTapRef(id, shapeTapRef);
    registerShapeDoubleTapRef(id, shapeDoubleTapRef);
    return () => {
      unregisterShapePanRef(id);
      unregisterShapeTapRef(id);
      unregisterShapeDoubleTapRef(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
        ) {
          didDrag.current = true;
        } else {
          return;
        }
      }
      dragByWorld(dxInc / camScale, dyInc / camScale); // screen → world
    },
    [camScale, dragByWorld]
  );

  const onSingleTapActivated = useCallback(() => {
    select(id);
  }, [id, select]);
  const onDoubleTapActivated = useCallback(() => {
    onDoubleTap();
  }, [onDoubleTap]);

  return (
    <TapGestureHandler
      ref={shapeDoubleTapRef}
      numberOfTaps={2}
      maxDelayMs={300}
      onActivated={onDoubleTapActivated}
      waitFor={shapePanRef}
    >
      <View style={[stylesShape.hit, { left, top, width, height }]}>
        <TapGestureHandler
          ref={shapeTapRef}
          waitFor={[shapeDoubleTapRef, shapePanRef, ...handleWaitFor]}
          maxDist={TAP_SLOP}
          onActivated={onSingleTapActivated}
        >
          <View style={StyleSheet.absoluteFill}>
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
            >
              <View style={StyleSheet.absoluteFill} />
            </PanGestureHandler>
          </View>
        </TapGestureHandler>
      </View>
    </TapGestureHandler>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  // Toolbar bottom-center
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

  // Editor overlay
  editorWrap: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#CBD5E1",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  editorInput: {
    minHeight: 24,
    fontSize: 16,
    color: "#111827",
  },
});

const stylesShape = StyleSheet.create({
  hit: { position: "absolute", backgroundColor: "transparent" },
});
