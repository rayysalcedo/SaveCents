// v4 "Grounded Editorial": GlassCard is now a MATTE SURFACE — solid fill,
// crisp 1px border, zero blur, zero shadow. (Shadows are reserved for
// floating elements: modals and the Cents FAB.) The component name and props
// are unchanged so every call site re-skins automatically.
import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { radius, useTheme } from '../theme/colors';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Legacy prop. Formerly a neon glow — now a quiet forest-green border. */
  glow?: boolean;
  pad?: number;
}

export function GlassCard({ children, style, glow = false, pad = 20 }: Props) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          padding: pad,
          backgroundColor: t.surface,
          borderColor: glow ? t.emeraldBorder : t.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, borderWidth: 1, flexGrow: 1 },
});
