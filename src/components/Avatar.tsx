// M5: profile avatars. Five cartoon animal portraits drawn in SVG with
// gradient shading and a gloss highlight for a 3D-toy look. Vector means they
// render crisp at any size with no bundled image assets.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import { useTheme } from '../theme/colors';

export interface AvatarDef {
  id: string;
  label: string;
  render: (size: number) => React.ReactNode;
}

// Shared gloss highlight for the 3D-toy sheen.
const Gloss = () => (
  <Ellipse cx={38} cy={26} rx={26} ry={14} fill="#FFFFFF" opacity={0.22} />
);

const Panda = (size: number) => (
  <Svg width={size} height={size} viewBox="0 0 100 100">
    <Defs>
      <SvgGradient id="pandaBg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#8FE3B0" /><Stop offset="1" stopColor="#3FBF7F" />
      </SvgGradient>
      <SvgGradient id="pandaFace" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#FFFFFF" /><Stop offset="1" stopColor="#E4E9E6" />
      </SvgGradient>
    </Defs>
    <Circle cx={50} cy={50} r={50} fill="url(#pandaBg)" />
    <Circle cx={30} cy={32} r={11} fill="#22262B" />
    <Circle cx={70} cy={32} r={11} fill="#22262B" />
    <Circle cx={50} cy={56} r={28} fill="url(#pandaFace)" />
    <Ellipse cx={39} cy={52} rx={8} ry={9.5} fill="#22262B" transform="rotate(-14 39 52)" />
    <Ellipse cx={61} cy={52} rx={8} ry={9.5} fill="#22262B" transform="rotate(14 61 52)" />
    <Circle cx={40.5} cy={51} r={2.6} fill="#FFFFFF" />
    <Circle cx={59.5} cy={51} r={2.6} fill="#FFFFFF" />
    <Ellipse cx={50} cy={65} rx={4.6} ry={3.4} fill="#22262B" />
    <Path d="M50 68 Q50 72 45 72 M50 68 Q50 72 55 72" stroke="#22262B" strokeWidth={2} strokeLinecap="round" fill="none" />
    <Gloss />
  </Svg>
);

const Fox = (size: number) => (
  <Svg width={size} height={size} viewBox="0 0 100 100">
    <Defs>
      <SvgGradient id="foxBg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#FFD9A0" /><Stop offset="1" stopColor="#F2A65A" />
      </SvgGradient>
      <SvgGradient id="foxFace" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#FF9F5A" /><Stop offset="1" stopColor="#E8763A" />
      </SvgGradient>
    </Defs>
    <Circle cx={50} cy={50} r={50} fill="url(#foxBg)" />
    <Path d="M24 24 L38 40 L24 46 Z" fill="url(#foxFace)" />
    <Path d="M76 24 L62 40 L76 46 Z" fill="url(#foxFace)" />
    <Path d="M27 27 L36 39 L28 42 Z" fill="#FFE8D2" />
    <Path d="M73 27 L64 39 L72 42 Z" fill="#FFE8D2" />
    <Circle cx={50} cy={56} r={27} fill="url(#foxFace)" />
    <Path d="M50 62 Q36 78 26 60 Q32 80 50 82 Q68 80 74 60 Q64 78 50 62 Z" fill="#FFE8D2" />
    <Circle cx={40} cy={52} r={3.6} fill="#3A2A20" />
    <Circle cx={60} cy={52} r={3.6} fill="#3A2A20" />
    <Circle cx={41} cy={51} r={1.2} fill="#FFFFFF" />
    <Circle cx={61} cy={51} r={1.2} fill="#FFFFFF" />
    <Path d="M46 64 Q50 68 54 64 L50 69 Z" fill="#3A2A20" />
    <Gloss />
  </Svg>
);

const Cat = (size: number) => (
  <Svg width={size} height={size} viewBox="0 0 100 100">
    <Defs>
      <SvgGradient id="catBg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#CBBDF6" /><Stop offset="1" stopColor="#8F7BE0" />
      </SvgGradient>
      <SvgGradient id="catFace" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#A9AFC4" /><Stop offset="1" stopColor="#7C849E" />
      </SvgGradient>
    </Defs>
    <Circle cx={50} cy={50} r={50} fill="url(#catBg)" />
    <Path d="M27 26 L40 40 L26 45 Z" fill="url(#catFace)" />
    <Path d="M73 26 L60 40 L74 45 Z" fill="url(#catFace)" />
    <Path d="M30 30 L38 39 L29 42 Z" fill="#F4B8C4" />
    <Path d="M70 30 L62 39 L71 42 Z" fill="#F4B8C4" />
    <Circle cx={50} cy={57} r={26} fill="url(#catFace)" />
    <Path d="M38 52 Q41 49 44 52 M56 52 Q59 49 62 52" stroke="#2E3140" strokeWidth={3} strokeLinecap="round" fill="none" />
    <Path d="M47 63 Q50 66 53 63 L50 67 Z" fill="#F4B8C4" />
    <Path d="M30 60 L18 58 M30 64 L19 66 M70 60 L82 58 M70 64 L81 66" stroke="#2E3140" strokeWidth={1.6} strokeLinecap="round" />
    <Circle cx={34} cy={62} r={4} fill="#F4B8C4" opacity={0.6} />
    <Circle cx={66} cy={62} r={4} fill="#F4B8C4" opacity={0.6} />
    <Gloss />
  </Svg>
);

const Dog = (size: number) => (
  <Svg width={size} height={size} viewBox="0 0 100 100">
    <Defs>
      <SvgGradient id="dogBg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#9ED2FF" /><Stop offset="1" stopColor="#4E9BE8" />
      </SvgGradient>
      <SvgGradient id="dogFace" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#C89B6E" /><Stop offset="1" stopColor="#A9784A" />
      </SvgGradient>
    </Defs>
    <Circle cx={50} cy={50} r={50} fill="url(#dogBg)" />
    <Ellipse cx={26} cy={46} rx={9} ry={16} fill="#8A5F38" transform="rotate(16 26 46)" />
    <Ellipse cx={74} cy={46} rx={9} ry={16} fill="#8A5F38" transform="rotate(-16 74 46)" />
    <Circle cx={50} cy={56} r={27} fill="url(#dogFace)" />
    <Ellipse cx={50} cy={66} rx={14} ry={11} fill="#E9D5BB" />
    <Circle cx={40} cy={50} r={3.8} fill="#2F2418" />
    <Circle cx={60} cy={50} r={3.8} fill="#2F2418" />
    <Circle cx={41} cy={49} r={1.3} fill="#FFFFFF" />
    <Circle cx={61} cy={49} r={1.3} fill="#FFFFFF" />
    <Ellipse cx={50} cy={62} rx={5} ry={4} fill="#2F2418" />
    <Path d="M50 66 Q50 71 44 70 M50 66 Q50 71 56 70" stroke="#2F2418" strokeWidth={2} strokeLinecap="round" fill="none" />
    <Path d="M44 74 Q50 78 56 74" stroke="#2F2418" strokeWidth={2} strokeLinecap="round" fill="none" />
    <Gloss />
  </Svg>
);

const Penguin = (size: number) => (
  <Svg width={size} height={size} viewBox="0 0 100 100">
    <Defs>
      <SvgGradient id="pengBg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#FFE9A8" /><Stop offset="1" stopColor="#F5C042" />
      </SvgGradient>
      <SvgGradient id="pengBody" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#3E4450" /><Stop offset="1" stopColor="#23272F" />
      </SvgGradient>
    </Defs>
    <Circle cx={50} cy={50} r={50} fill="url(#pengBg)" />
    <Ellipse cx={50} cy={58} rx={27} ry={30} fill="url(#pengBody)" />
    <Ellipse cx={50} cy={64} rx={18} ry={21} fill="#F4F6F8" />
    <Circle cx={41} cy={46} r={4} fill="#23272F" />
    <Circle cx={59} cy={46} r={4} fill="#23272F" />
    <Circle cx={42} cy={45} r={1.4} fill="#FFFFFF" />
    <Circle cx={60} cy={45} r={1.4} fill="#FFFFFF" />
    <Path d="M44 54 L56 54 L50 61 Z" fill="#F5A623" />
    <Ellipse cx={26} cy={60} rx={6} ry={13} fill="#23272F" transform="rotate(18 26 60)" />
    <Ellipse cx={74} cy={60} rx={6} ry={13} fill="#23272F" transform="rotate(-18 74 60)" />
    <Gloss />
  </Svg>
);

export const AVATARS: AvatarDef[] = [
  { id: 'panda', label: 'Panda', render: Panda },
  { id: 'fox', label: 'Fox', render: Fox },
  { id: 'cat', label: 'Cat', render: Cat },
  { id: 'dog', label: 'Dog', render: Dog },
  { id: 'penguin', label: 'Penguin', render: Penguin },
];

export function avatarById(id?: string | null): AvatarDef | null {
  return AVATARS.find((a) => a.id === id) ?? null;
}

// Renders the chosen animal avatar, or an initials disc when none is picked.
export function AvatarBadge({ avatarId, name, size }: { avatarId?: string | null; name: string; size: number }) {
  const t = useTheme();
  const def = avatarById(avatarId);
  if (def) {
    return <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>{def.render(size)}</View>;
  }
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length === 0 ? '?' : parts.length === 1 ? parts[0].slice(0, 1).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (
    <View style={[styles.initials, { width: size, height: size, borderRadius: size / 2, backgroundColor: t.insetBg }]}>
      <Text style={{ color: t.emerald, fontSize: size * 0.34, fontWeight: '800', letterSpacing: 1 }}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  initials: { alignItems: 'center', justifyContent: 'center' },
});
