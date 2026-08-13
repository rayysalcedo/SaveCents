// v5.40: TrendChart v2 - the owner's field report rebuilt from the ground up.
//
// 1. WHEEL MODE (Monthly/Yearly): pass pointGap and the chart becomes a
//    horizontally scrollable timeline - every point gets fixed comfortable
//    spacing, EVERY label shows (all 31 day numbers, Jan..Dec in full), you
//    flick through the period with native momentum like a crypto app, and it
//    parks on the newest point. Weekly stays fixed-width (7 points fit).
// 2. GESTURE SPLIT in wheel mode: swipe pans (native ScrollView), a TAP pins
//    a point, a short HOLD (~0.22s) then drag engages the scrubber - we deny
//    the ScrollView's termination request only while scrubbing, so pan and
//    scrub coexist without fighting. Fixed mode keeps instant tap/drag.
// 3. 60FPS SCRUBBER: the marker line, dot and bubble are native-driver
//    Animated views riding tight springs - the dot GLIDES between points
//    instead of teleporting, with a spring-scale entrance and fade-out.
// 4. NO FOLD: the component's height is constant (bubble row + chart + tick
//    row are all fixed), selection clears via resetKey WITHOUT remounting,
//    and new data eases in with a fade + rise. Nothing collapses.
// 5. MONOTONE CURVE (Steffen): the smoothing can never overshoot the real
//    data - no more fake dips between spikes.
//
// House vibe throughout: emerald line, glass bubble, the app's money type.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Defs, Line, LinearGradient as SvgGradient, Path, Stop,
} from 'react-native-svg';
import { Palette, type, useTheme } from '../theme/colors';
import { peso } from '../models/types';

export interface TrendPoint {
  label: string; // x-axis tick under the point (always shown)
  sub: string;   // bubble/header label, e.g. "Tue, Aug 12" or "Aug 2026"
  value: number;
}

const PAD_X = 14;
const BUBBLE_H = 48;
const TICK_H = 20;
const HOLD_MS = 220;   // wheel mode: hold this long, then drag = scrub
const TAP_SLOP = 10;   // px of movement that turns a hold into a pan

function steffenPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  const h: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(pts[i + 1].x - pts[i].x);
    s.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  }
  // Steffen's method: monotone tangents, guaranteed no overshoot.
  const m: number[] = new Array(n);
  m[0] = s[0];
  m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (s[i - 1] * s[i] <= 0) { m[i] = 0; continue; }
    const p = (s[i - 1] * h[i] + s[i] * h[i - 1]) / (h[i - 1] + h[i]);
    const cap = 2 * Math.min(Math.abs(s[i - 1]), Math.abs(s[i]));
    m[i] = (Math.sign(s[i - 1]) || 1) * Math.min(Math.abs(p), cap);
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = h[i] / 3;
    d += ` C ${pts[i].x + dx} ${pts[i].y + m[i] * dx}, ${pts[i + 1].x - dx} ${pts[i + 1].y - m[i + 1] * dx}, ${pts[i + 1].x} ${pts[i + 1].y}`;
  }
  return d;
}

export function TrendChart({ points, ghost, height = 150, color, onScrub, pointGap, resetKey }: {
  points: TrendPoint[];
  ghost?: number[];        // inactive metric, same length, faint behind
  height?: number;
  color?: string;          // active line color (defaults to emerald)
  onScrub?: (index: number | null) => void;
  pointGap?: number;       // set = wheel mode (horizontal scroll, fixed spacing)
  resetKey?: string;       // change = clear selection + ease the new data in
}) {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const lineColor = color ?? t.emerald;
  const [viewportW, setViewportW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const scrollable = pointGap != null;

  // ── Geometry ────────────────────────────────────────────────────────────
  const geom = useMemo(() => {
    const n = points.length;
    if (n === 0 || viewportW <= 0) return null;
    // Wheel mode: fixed gap, but never narrower than the viewport.
    const gap = scrollable
      ? Math.max(pointGap!, n > 1 ? (viewportW - PAD_X * 2) / (n - 1) : 0)
      : n > 1 ? (viewportW - PAD_X * 2) / (n - 1) : 0;
    const contentW = scrollable ? PAD_X * 2 + gap * Math.max(n - 1, 0) : viewportW;
    const x = (i: number) => (n === 1 ? contentW / 2 : PAD_X + i * gap);
    const vals = points.map((p) => p.value);
    const all = ghost && ghost.length === n ? [...vals, ...ghost] : vals;
    // v5.41 (owner's #1): the domain covers BOTH series and never changes
    // with the metric toggle - so switching Net/Spent literally swaps which
    // of the two identical curves is in front, instead of rescaling into
    // what looked like two unrelated charts (the net line, mostly negative,
    // was being squashed below a zero-clamped spent domain).
    const hasNeg = Math.min(...all) < 0;
    let lo = hasNeg ? Math.min(...all, 0) : 0;
    let hi = Math.max(...all, 0);
    if (hi === lo) { hi += 1; if (hasNeg) lo -= 1; }
    const innerH = height - 14;
    const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo)) * innerH;
    const pts = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
    const ghostPts = ghost && ghost.length === n ? ghost.map((v, i) => ({ x: x(i), y: y(v) })) : null;
    const zeroY = hasNeg ? y(0) : null;
    const line = steffenPath(pts);
    const area = n >= 2
      ? `${line} L ${pts[n - 1].x} ${height - 2} L ${pts[0].x} ${height - 2} Z`
      : '';
    return { pts, ghostPts, line, area, zeroY, x, contentW, gap };
  }, [points, ghost, viewportW, height, scrollable, pointGap]);

  // Refs mirror render values so the once-created PanResponder never closes
  // over stale geometry.
  const geomRef = useRef(geom); geomRef.current = geom;
  const nRef = useRef(points.length); nRef.current = points.length;
  const onScrubRef = useRef(onScrub); onScrubRef.current = onScrub;
  const scrubbingRef = useRef(false);

  const idxFromX = (x: number) => {
    const g = geomRef.current;
    const n = nRef.current;
    if (!g || n < 1) return null;
    if (n === 1) return 0;
    return Math.min(Math.max(Math.round((x - PAD_X) / g.gap), 0), n - 1);
  };

  // ── The animated scrubber (native driver, springs) ──────────────────────
  const markerX = useRef(new Animated.Value(0)).current;
  const dotY = useRef(new Animated.Value(0)).current;
  const bubbleX = useRef(new Animated.Value(0)).current;
  const markerIn = useRef(new Animated.Value(0)).current; // 0 hidden → 1 shown
  const dataIn = useRef(new Animated.Value(1)).current;   // data fade + rise
  const BUBBLE_W = 132;
  const spring = (v: Animated.Value, to: number) =>
    Animated.spring(v, { toValue: to, useNativeDriver: true, stiffness: 320, damping: 26, mass: 0.7 }).start();

  const moveMarkerTo = (i: number, animated = true) => {
    const g = geomRef.current;
    if (!g || i < 0 || i >= g.pts.length) return;
    const bx = Math.min(Math.max(g.pts[i].x - BUBBLE_W / 2, 2), Math.max(g.contentW - BUBBLE_W - 2, 2));
    if (animated) {
      spring(markerX, g.pts[i].x);
      spring(dotY, g.pts[i].y);
      spring(bubbleX, bx);
    } else {
      markerX.setValue(g.pts[i].x);
      dotY.setValue(g.pts[i].y);
      bubbleX.setValue(bx);
    }
  };

  const engage = (i: number, firstTouch: boolean) => {
    setSel(i);
    onScrubRef.current?.(i);
    if (firstTouch) {
      moveMarkerTo(i, false); // appear AT the finger, then glide from there
      Animated.spring(markerIn, { toValue: 1, useNativeDriver: true, stiffness: 300, damping: 20 }).start();
    } else {
      moveMarkerTo(i, true);
    }
  };

  const clearSel = () => {
    setSel(null);
    onScrubRef.current?.(null);
    Animated.timing(markerIn, { toValue: 0, duration: 140, useNativeDriver: true }).start();
  };

  // resetKey: new period/metric/range → clear the pin and ease data in.
  // NO remount, constant height - this is the anti-fold.
  const lastReset = useRef(resetKey);
  useEffect(() => {
    if (resetKey === lastReset.current) return;
    lastReset.current = resetKey;
    setSel(null);
    setScrubbing(false);
    scrubbingRef.current = false;
    markerIn.setValue(0);
    onScrubRef.current?.(null);
    dataIn.setValue(0);
    Animated.timing(dataIn, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    parkedFor.current = null; // re-park the wheel on the newest point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Park the wheel at the newest point whenever the data set changes.
  const parkedFor = useRef<string | null>(null);
  const park = () => {
    if (!scrollable) return;
    if (parkedFor.current === resetKey) return;
    parkedFor.current = resetKey ?? 'static';
    scrollRef.current?.scrollToEnd({ animated: false });
  };

  // ── Gestures ────────────────────────────────────────────────────────────
  // Fixed mode (weekly): first touch scrubs immediately, capture everything.
  const fixedPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: (evt) => {
      const i = idxFromX(evt.nativeEvent.locationX);
      if (i != null) engage(i, true);
    },
    onPanResponderMove: (evt) => {
      const i = idxFromX(evt.nativeEvent.locationX);
      if (i != null) engage(i, false);
    },
    onPanResponderTerminationRequest: () => false,
  })).current;

  // Wheel mode: tap pins, hold-then-drag scrubs, plain swipe pans (we hand
  // the gesture to the ScrollView by allowing termination until the hold
  // engages, then deny it).
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startX = useRef(0);
  const movedFar = useRef(false);
  const wheelPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => false,
    onPanResponderGrant: (evt) => {
      startX.current = evt.nativeEvent.locationX;
      movedFar.current = false;
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        if (movedFar.current) return;
        scrubbingRef.current = true;
        setScrubbing(true);
        const i = idxFromX(startX.current);
        if (i != null) engage(i, true);
      }, HOLD_MS);
    },
    onPanResponderMove: (evt) => {
      const x = evt.nativeEvent.locationX;
      if (scrubbingRef.current) {
        const i = idxFromX(x);
        if (i != null) engage(i, false);
        return;
      }
      if (Math.abs(x - startX.current) > TAP_SLOP) {
        movedFar.current = true;
        if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
      }
    },
    onPanResponderRelease: () => {
      if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
      if (!scrubbingRef.current && !movedFar.current) {
        // A clean tap: pin that point.
        const i = idxFromX(startX.current);
        if (i != null) engage(i, true);
      }
      scrubbingRef.current = false;
      setScrubbing(false);
    },
    onPanResponderTerminate: () => {
      if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
      scrubbingRef.current = false;
      setScrubbing(false);
    },
    // The heart of the gesture split: the ScrollView may steal the touch to
    // pan UNLESS the hold already engaged the scrubber.
    onPanResponderTerminationRequest: () => !scrubbingRef.current,
  })).current;

  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

  const hasData = points.some((p) => p.value !== 0) || (ghost ?? []).some((v) => v !== 0);
  // Render-safe pin: a stale index from the previous (longer) period must
  // never touch the new (shorter) points array - the clearing effect only
  // runs AFTER this render.
  const selSafe = sel != null && sel >= 0 && sel < points.length ? sel : null;
  const selVal = selSafe != null ? points[selSafe].value : 0;

  // ── Content (identical in both modes; wheel wraps it in a ScrollView) ───
  const content = geom && (
    <Animated.View
      style={{
        width: geom.contentW,
        opacity: dataIn,
        transform: [{ translateY: dataIn.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
      }}
      {...(scrollable ? wheelPan.panHandlers : fixedPan.panHandlers)}
    >
      {/* Bubble row: constant height, bubble rides its point */}
      <View style={{ height: BUBBLE_H }}>
        {selSafe != null && (
          <Animated.View
            pointerEvents="none"
            style={[styles.bubble, {
              width: BUBBLE_W,
              opacity: markerIn,
              transform: [
                { translateX: bubbleX },
                { scale: markerIn.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
              ],
            }]}
          >
            <Text style={styles.bubbleSub} numberOfLines={1}>{points[selSafe].sub}</Text>
            <Text style={[styles.bubbleVal, selVal < 0 && { color: t.red }]} numberOfLines={1}>
              {selVal < 0 ? `-${peso(Math.abs(selVal))}` : peso(selVal)}
            </Text>
          </Animated.View>
        )}
      </View>
      <View style={{ height, width: geom.contentW }}>
        <Svg width={geom.contentW} height={height}>
          <Defs>
            <SvgGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={lineColor} stopOpacity={0.2} />
              <Stop offset="1" stopColor={lineColor} stopOpacity={0.01} />
            </SvgGradient>
          </Defs>
          {geom.zeroY != null && (
            <Line
              x1={PAD_X} y1={geom.zeroY} x2={geom.contentW - PAD_X} y2={geom.zeroY}
              stroke={t.borderSoft} strokeWidth={1} strokeDasharray="4 5"
            />
          )}
          {geom.ghostPts && geom.ghostPts.length >= 2 && (
            <Path d={steffenPath(geom.ghostPts)} stroke={t.textFaint} strokeOpacity={0.45} strokeWidth={1.6} fill="none" />
          )}
          {!!geom.area && <Path d={geom.area} fill="url(#trendFill)" />}
          {!!geom.line && points.length >= 2 && (
            <Path d={geom.line} stroke={lineColor} strokeWidth={2.4} fill="none" strokeLinecap="round" />
          )}
        </Svg>
        {/* Native-driver scrubber: line + gliding dot */}
        <Animated.View
          pointerEvents="none"
          style={[styles.markerLine, {
            backgroundColor: lineColor,
            height: height - 6,
            opacity: markerIn.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }),
            transform: [{ translateX: markerX }],
          }]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.markerDot, {
            backgroundColor: lineColor,
            opacity: markerIn,
            transform: [
              { translateX: markerX },
              { translateY: dotY },
              { scale: markerIn.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
            ],
          }]}
        />
        {!hasData && (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
            <Text style={styles.emptyText}>Nothing recorded in this period yet</Text>
          </View>
        )}
      </View>
      {/* Ticks: EVERY point gets its label, centered under it */}
      <View style={{ height: TICK_H, width: geom.contentW }}>
        {points.map((p, i) => (
          <Text
            key={i}
            style={[styles.tick, {
              left: geom.x(i) - geom.gap / 2,
              width: Math.max(geom.gap, 30),
              color: selSafe === i ? lineColor : t.textFaint,
              fontWeight: selSafe === i ? '800' : '600',
            }]}
            numberOfLines={1}
          >
            {p.label}
          </Text>
        ))}
      </View>
    </Animated.View>
  );

  // Constant outer height in every state - the card can never fold.
  return (
    <View
      style={{ height: BUBBLE_H + height + TICK_H }}
      onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
    >
      {viewportW > 0 && geom && (
        scrollable ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={!scrubbing}
            onContentSizeChange={park}
            decelerationRate="normal"
            overScrollMode="never"
          >
            {content}
          </ScrollView>
        ) : content
      )}
    </View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  bubble: {
    position: 'absolute', top: 0, left: 0,
    borderRadius: 12, paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: t.menuBg, borderWidth: 1, borderColor: t.border,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
    alignItems: 'center',
  },
  bubbleSub: { color: t.textMuted, fontSize: 10.5, fontWeight: '700' },
  bubbleVal: { color: t.textPrimary, fontSize: 14.5, fontWeight: '800', marginTop: 1, ...type.money },
  markerLine: {
    position: 'absolute', top: 2, left: -0.6, width: 1.4,
    backgroundColor: t.emerald,
  },
  markerDot: {
    position: 'absolute', top: -6.5, left: -6.5, width: 13, height: 13, borderRadius: 7,
    backgroundColor: t.emerald, borderWidth: 2.5, borderColor: t.surface,
  },
  tick: { position: 'absolute', top: 3, textAlign: 'center', fontSize: 10.5 },
  emptyText: { color: t.textMuted, fontSize: 12.5 },
});
