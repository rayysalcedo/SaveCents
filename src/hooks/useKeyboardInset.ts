// Animated keyboard inset for absolute/transformed overlays, where
// KeyboardAvoidingView mis-measures its frame. iOS: keyboardWillChangeFrame
// tracks the real frame (including interactive dismiss) and animates with the
// keyboard's own duration; Android: did-show/hide is the reliable pair.
import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Keyboard, Platform } from 'react-native';

export function useKeyboardInset() {
  const inset = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      const sub = Keyboard.addListener('keyboardWillChangeFrame', (e) => {
        const h = Math.max(0, Dimensions.get('window').height - e.endCoordinates.screenY);
        setVisible(h > 0);
        Animated.timing(inset, {
          toValue: h,
          duration: e.duration > 0 ? e.duration : 250,
          easing: Easing.bezier(0.17, 0.59, 0.4, 0.77),
          useNativeDriver: false, // height cannot use the native driver
        }).start();
      });
      return () => sub.remove();
    }
    const s1 = Keyboard.addListener('keyboardDidShow', (e) => {
      setVisible(true);
      Animated.timing(inset, { toValue: e.endCoordinates.height, duration: 180, useNativeDriver: false }).start();
    });
    const s2 = Keyboard.addListener('keyboardDidHide', () => {
      setVisible(false);
      Animated.timing(inset, { toValue: 0, duration: 180, useNativeDriver: false }).start();
    });
    return () => { s1.remove(); s2.remove(); };
  }, [inset]);

  return { inset, visible };
}
