// M5.6 — drag-to-dismiss for every bottom sheet. The little handle pills were
// decorative until now (owner report: "the drag option to minimize doesn't
// work at all"). One PanResponder + one Animated.Value per sheet:
//   - drag follows the finger (downward only),
//   - release past 110px or a fast flick slides the sheet out and calls
//     onDismiss,
//   - anything less springs back.
// Attach `panHandlers` to a GRAB ZONE around the handle, not the whole sheet:
// sheets contain ScrollViews and inputs, and a whole-sheet responder would
// steal their vertical scrolls (the same class of bug as the chat FlatList
// Pressable wrapper, see v25).
import { useRef } from 'react';
import { Animated, PanResponder } from 'react-native';

export function useDragToDismiss(onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const drag = useRef(new Animated.Value(0)).current;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => { drag.setValue(Math.max(g.dy, 0)); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || g.vy > 0.8) {
          Animated.timing(drag, { toValue: 700, duration: 170, useNativeDriver: true }).start(() => {
            drag.setValue(0); // reset for the next open
            onDismissRef.current();
          });
        } else {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, friction: 8, tension: 140 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
      },
    }),
  ).current;

  return { drag, panHandlers: pan.panHandlers };
}
