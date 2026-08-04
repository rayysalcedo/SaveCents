// Landing pad for the Google OAuth deep link. The auth session has already
// captured the token by the time this renders; just hand off to the gate.
import { Redirect } from 'expo-router';

export default function OAuthRedirect() {
  return <Redirect href="/" />;
}