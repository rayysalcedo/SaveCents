import { Redirect } from 'expo-router';
import { useFinance } from '../src/store/finance';

export default function Index() {
  const loggedIn = useFinance((s) => s.profile.isLoggedIn);
  return <Redirect href={loggedIn ? '/(tabs)/dashboard' : '/auth'} />;
}
