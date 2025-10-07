import React, { useCallback, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { PanGestureHandler, State } from "react-native-gesture-handler";

export default function ShapeOverlay(props: {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  select: (id: string | null) => void;
  beginDrag: (id: string) => void;
  dragByWorld: (dxWorld: number, dyWorld: number) => void;
  endDrag: () => void;
  camScale: number;
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
  } = props;

  // track total movement to decide tap vs drag
  const startXY = useRef({ x: 0, y: 0 });
  const lastXY = useRef({ x: 0, y: 0 });
  const didDrag = useRef(false);
  const TAP_SLOP = 8; // px

  const onStateChange = useCallback(
    (e: any) => {
      const st = e.nativeEvent.state;
      if (st === State.BEGAN) {
        didDrag.current = false;
        startXY.current = { x: 0, y: 0 };
        lastXY.current = { x: 0, y: 0 };
        beginDrag(id);
      }
      if (st === State.END || st === State.CANCELLED || st === State.FAILED) {
        // tap if movement was tiny
        const dx = lastXY.current.x;
        const dy = lastXY.current.y;
        const dist = Math.hypot(dx, dy);
        if (!didDrag.current && dist < TAP_SLOP) {
          select(id);
        }
        endDrag();
      }
    },
    [id, beginDrag, endDrag, select]
  );

  const onGesture = useCallback(
    (e: any) => {
      const { translationX, translationY } = e.nativeEvent ?? {};
      if (!Number.isFinite(translationX) || !Number.isFinite(translationY))
        return;

      lastXY.current = { x: translationX, y: translationY };

      // if user moved beyond slop, it’s a drag
      if (!didDrag.current) {
        if (
          Math.abs(translationX) > TAP_SLOP ||
          Math.abs(translationY) > TAP_SLOP
        ) {
          didDrag.current = true;
        } else {
          return; // still tap territory; don’t apply tiny drags
        }
      }

      // convert screen deltas to world deltas
      dragByWorld(translationX / camScale, translationY / camScale);
    },
    [camScale, dragByWorld]
  );

  return (
    <PanGestureHandler
      onHandlerStateChange={onStateChange}
      onGestureEvent={onGesture}
      minPointers={1}
      maxPointers={1}
      shouldCancelWhenOutside={false}
    >
      <View style={[stylesShape.hit, { left, top, width, height }]} />
    </PanGestureHandler>
  );
}

const stylesShape = StyleSheet.create({
  hit: { position: "absolute", backgroundColor: "transparent" },
});
