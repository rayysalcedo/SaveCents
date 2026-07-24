import { Redirect } from 'expo-router';
import { useFinance } from '../src/store/finance';

export default function Index() {
  const hasHydrated = useFinance((s) => s.hasHydrated);
  const loggedIn = useFinance((s) => s.profile.isLoggedIn);
  if (!hasHydrated) return null; // themed root background shows for ~1 frame
  return <Redirect href={loggedIn ? '/(tabs)/dashboard' : '/auth'} />;
}