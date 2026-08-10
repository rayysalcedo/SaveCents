import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle, Defs, Line, LinearGradient as SvgGradient, Path, Stop,
} from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { C, useTheme, type } from '../theme/colors';
import { peso } from '../models/types';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// ---------------- Segmented donut ----------------

export interface DonutSegment { value: number; color: string }

export function SegmentedDonut({
  segments, size = 150, stroke = 14, gapDeg = 6,
}: { segments: DonutSegment[]; size?: number; stroke?: number; gapDeg?: number }) {
  const r = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const usable = 360 - gapDeg * segments.length;

  let angle = -90;
  const arcs = segments.map((seg, i) => {
    const sweep = (seg.value / total) * usable;
    const d = describeArc(cx, cy, r, angle + gapDeg / 2, angle + gapDeg / 2 + sweep);
    angle += sweep + gapDeg;
    return <Path key={i} d={d} stroke={seg.color} strokeWidth={stroke} strokeLinecap="round" fill="none" />;
  });

  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={r} stroke={C.emeraldGlow} strokeWidth={stroke + 8} fill="none" opacity={0.3} />
      {arcs}
    </Svg>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function describeArc(cx: number, cy: number, r: number, start: number, end: number) {
  const s = polar(cx, cy, r, start);
  const e = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

// ---------------- Flat editorial pie ----------------
// v4.1: replaces the segmented donut on the Allocation card. Solid wedges,
// hairline background-colored seams between slices, no gloss. A lone slice
// renders as a clean full disc.

export function PieChart({
  segments, size = 132, seam = '#FAF9F6',
}: { segments: DonutSegment[]; size?: number; seam?: string }) {
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 2;
  const total = segments.reduce((a, s) => a + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);

  if (total <= 0 || visible.length === 0) {
    return (
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} fill="rgba(127,184,154,0.18)" />
      </Svg>
    );
  }
  if (visible.length === 1) {
    return (
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} fill={visible[0].color} />
      </Svg>
    );
  }

  let angle = -90;
  const wedges = visible.map((seg, i) => {
    const sweep = (seg.value / total) * 360;
    const s = polar(cx, cy, r, angle);
    const e = polar(cx, cy, r, angle + sweep);
    const large = sweep > 180 ? 1 : 0;
    const d = `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
    angle += sweep;
    // The seam stroke (background color) draws crisp hairlines between slices.
    return <Path key={i} d={d} fill={seg.color} stroke={seam} strokeWidth={1.5} />;
  });

  return <Svg width={size} height={size}>{wedges}</Svg>;
}

// ---------------- Animated goal trajectory ----------------
// Solid glowing curve draws in up to the current position; the remainder is a
// dashed projection. Pulsing halo marks "you are here".

const P0 = { x: 0, y: 0.9 }, P1 = { x: 0.35, y: 0.9 }, P2 = { x: 0.55, y: 0.15 }, P3 = { x: 1, y: 0.1 };

function bez(t: number, w: number, h: number) {
  const u = 1 - t;
  return {
    x: (u * u * u * P0.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x) * w,
    y: (u * u * u * P0.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * P3.y) * h,
  };
}

export function TrajectoryCurve({
  width, height = 120, progress = 0.33,
}: { width: number; height?: number; progress?: number }) {
  const t = useTheme();
  const w = width, h = height;
  const clamped = Math.min(Math.max(progress, 0.02), 1);

  const { path, totalLen, progLen, dot } = useMemo(() => {
    const N = 60;
    let len = 0, pLen = 0;
    let prev = bez(0, w, h);
    for (let i = 1; i <= N; i++) {
      const pt = bez(i / N, w, h);
      const seg = Math.hypot(pt.x - prev.x, pt.y - prev.y);
      len += seg;
      if (i / N <= clamped) pLen = len;
      prev = pt;
    }
    return {
      path: `M ${P0.x * w} ${P0.y * h} C ${P1.x * w} ${P1.y * h}, ${P2.x * w} ${P2.y * h}, ${P3.x * w} ${P3.y * h}`,
      totalLen: len,
      progLen: pLen,
      dot: bez(clamped, w, h),
    };
  }, [w, h, clamped]);

  const draw = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    draw.setValue(0);
    Animated.timing(draw, {
      toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [draw, progLen]);

  // PERF (v17): the marker used to pulse via an INFINITE Animated.loop with
  // useNativeDriver:false. Animated SVG props run on the JS thread, so the
  // loop fired ~60 updates/sec forever once Home or Goals mounted, starving
  // Pressable/scroll gesture handling across the WHOLE app ("have to tap
  // multiple times"). The halo is now static. Never reintroduce an unbounded
  // JS-driven loop; if it must move, keep it finite or move it off SVG props.
  const dashOffset = draw.interpolate({ inputRange: [0, 1], outputRange: [progLen, 0] });

  const grid = t.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(2,44,34,0.07)';

  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        <Defs>
          <SvgGradient id="traj" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={C.teal} stopOpacity="0.7" />
            <Stop offset="1" stopColor={C.emerald} stopOpacity="1" />
          </SvgGradient>
          <SvgGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.emerald} stopOpacity={t.mode === 'dark' ? '0.24' : '0.18'} />
            <Stop offset="1" stopColor={C.emerald} stopOpacity="0" />
          </SvgGradient>
        </Defs>

        {/* grid */}
        {[0.25, 0.5, 0.75].map((g) => (
          <Line key={g} x1={0} y1={h * g} x2={w} y2={h * g} stroke={grid} strokeWidth={1} />
        ))}

        {/* area fill */}
        <Path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill="url(#fill)" />

        {/* dashed projection (full curve, faint) */}
        <Path
          d={path} stroke={t.mode === 'dark' ? 'rgba(110,231,183,0.28)' : 'rgba(13,148,136,0.3)'}
          strokeWidth={2} strokeDasharray="2 7" fill="none" strokeLinecap="round"
        />

        {/* glow under solid segment */}
        <AnimatedPath
          d={path} stroke={C.emerald} strokeWidth={9} strokeOpacity={0.16} fill="none" strokeLinecap="round"
          strokeDasharray={`${progLen} ${totalLen}`}
          strokeDashoffset={dashOffset as any}
        />
        {/* solid drawn segment */}
        <AnimatedPath
          d={path} stroke="url(#traj)" strokeWidth={3.5} fill="none" strokeLinecap="round"
          strokeDasharray={`${progLen} ${totalLen}`}
          strokeDashoffset={dashOffset as any}
        />

        {/* marker with a static halo (see PERF note above) */}
        <Circle cx={dot.x} cy={dot.y} r={10} fill={C.emerald} opacity={0.22} />
        <Circle cx={dot.x} cy={dot.y} r={5} fill={C.emerald} />
        <Circle cx={dot.x} cy={dot.y} r={2} fill="#FFFFFF" />
      </Svg>
    </View>
  );
}

// ---------------- Monthly savings bars (MoM) ----------------

export interface MonthBar { label: string; value: number }

export function MoMBars({
  data, height = 130, highlightLast = true,
}: { data: MonthBar[]; height?: number; highlightLast?: boolean }) {
  const t = useTheme();
  const max = Math.max(...data.map((d) => d.value), 1);
  // Same growing pool as SpendBars: a fixed size pool crashes with
  // undefined.interpolate the moment the data array gets longer mid-session.
  const anims = useRef<Animated.Value[]>([]).current;
  while (anims.length < data.length) anims.push(new Animated.Value(0));

  useEffect(() => {
    Animated.stagger(
      80,
      anims.slice(0, data.length).map((a) =>
        Animated.timing(a, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      ),
    ).start();
  }, [anims, data.length]);

  return (
    <View style={[styles.momRow, { height: height + 26 }]}>
      {data.map((d, i) => {
        const active = highlightLast && i === data.length - 1;
        const hPct = (d.value / max) * 100;
        return (
          <View key={d.label} style={styles.momCol}>
            <View style={[styles.momTrack, { height, backgroundColor: t.trackBg }]}>
              <Animated.View
                style={{
                  width: '100%',
                  height: anims[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.max(hPct, 4)}%`] }),
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                <View style={{ flex: 1, backgroundColor: active ? t.emerald : (t.mode === 'dark' ? 'rgba(46,158,91,0.35)' : 'rgba(22,91,51,0.30)') }} />
              </Animated.View>
            </View>
            <Text style={[styles.momLabel, { color: active ? t.textPrimary : t.textMuted }, active && { fontWeight: '800' }]}>
              {d.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------- Horizontal spend bars ----------------

export interface SpendRow { name: string; spent: number; limit: number }

export function SpendBars({ data }: { data: SpendRow[] }) {
  const t = useTheme();
  const sorted = [...data].sort((a, b) => b.spent - a.spent).slice(0, 4);
  // The anim pool GROWS with the data. The old version sized it once on
  // first render, so adding a budget mid-session handed new bars an
  // undefined anim and crashed on .interpolate. Appending is idempotent,
  // safe to do during render, and existing bars keep their values.
  const anims = useRef<Animated.Value[]>([]).current;
  while (anims.length < sorted.length) anims.push(new Animated.Value(0));

  useEffect(() => {
    Animated.stagger(
      90,
      anims.slice(0, sorted.length).map((a) =>
        Animated.timing(a, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      ),
    ).start();
    // Re-run when the bar count changes so newly added bars animate in
    // instead of sitting at zero width.
  }, [anims, sorted.length]);

  return (
    <View style={{ gap: 12 }}>
      {sorted.map((c, i) => {
        const pct = Math.min(c.spent / c.limit, 1);
        const maxed = pct >= 1;
        const top = i === 0;
        return (
          <View key={c.name}>
            <View style={styles.spendHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.spendName, { color: t.textPrimary }]}>{c.name}</Text>
                {top && (
                  <View style={[styles.topBadge, { backgroundColor: maxed ? t.redTint : t.emeraldTint }]}>
                    <Ionicons name="flame" size={9} color={maxed ? C.red : C.emerald} />
                    <Text style={[styles.topBadgeText, { color: maxed ? C.red : C.emerald }]}>TOP</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.spendVal, { color: maxed ? C.red : t.textMuted }]}>
                {peso(c.spent)} / {peso(c.limit)}
              </Text>
            </View>
            <View style={[styles.spendTrack, { backgroundColor: t.trackBg }]}>
              <Animated.View
                style={{
                  height: '100%',
                  width: anims[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.max(pct * 100, 3)}%`] }),
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                <View style={{ flex: 1, backgroundColor: maxed ? C.red : t.emerald }} />
              </Animated.View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  momRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  momCol: { flex: 1, alignItems: 'center', gap: 6 },
  momTrack: { width: '100%', borderRadius: 8, overflow: 'hidden', justifyContent: 'flex-end' },
  momLabel: { fontSize: 11, fontWeight: '600' },
  spendHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  spendName: { fontSize: 13, fontWeight: '700' },
  spendVal: { fontSize: 11, fontWeight: '600', ...type.money },
  topBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2,
  },
  topBadgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  spendTrack: { height: 9, borderRadius: 6, overflow: 'hidden' },
});
