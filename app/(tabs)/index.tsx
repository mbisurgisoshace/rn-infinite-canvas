import InfiniteCanvas from "@/components/CanvasModule/InfiniteCanvas";
import React, { useState } from "react";
import { Gesture } from "react-native-gesture-handler";

export default function PanOnly() {
  const [tx, setTx] = useState(0),
    [ty, setTy] = useState(0);
  const pan = Gesture.Pan()
    .minPointers(1)
    .onChange((e) => {
      if (Number.isFinite(e.changeX) && Number.isFinite(e.changeY)) {
        setTx((v) => v + e.changeX);
        setTy((v) => v + e.changeY);
      }
    });
  return <InfiniteCanvas />;
}
