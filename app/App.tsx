import './src/font'; // apply the Chillax font mapping before anything renders
import React, { useEffect, useRef, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import { AppState, Image, Pressable, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useFonts } from 'expo-font';
import { storeGet } from './src/storage';
import { biometricAvailable } from './src/auth';
import { LockKey } from 'phosphor-react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ConnProvider, useConn } from './src/conn';
import { C } from './src/theme';
import FloatingTabBar from './src/TabBar';
import ClipSnack from './src/Snack';
import Toast from './src/Toast';
import Notifier from './src/notify';
import Connect from './src/screens/Connect';
import Home from './src/screens/Home';
import LiveScreen from './src/screens/Screen';
import Guard from './src/screens/Guard';
import Activity from './src/screens/Activity';
import Settings from './src/screens/Settings';
import Processes from './src/screens/Processes';
import ClipboardScreen from './src/screens/Clipboard';
import Files from './src/screens/Files';
import Terminal from './src/screens/Terminal';
import Apps from './src/screens/Apps';
import Network from './src/screens/Network';
import Control from './src/screens/Control';
import Diagnostics from './src/screens/Diagnostics';
import Rules from './src/screens/Rules';
import SensorTuning from './src/screens/SensorTuning';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: C.canvas } };

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} />}>
      <Tab.Screen name="Home" component={Home} />
      <Tab.Screen name="Screen" component={LiveScreen} />
      <Tab.Screen name="Guard" component={Guard} />
      <Tab.Screen name="Activity" component={Activity} />
      <Tab.Screen name="Settings" component={Settings} />
    </Tab.Navigator>
  );
}

function Main() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.canvas } }}>
      <Stack.Screen name="Tabs" component={Tabs} />
      <Stack.Screen name="Processes" component={Processes} />
      <Stack.Screen name="Clipboard" component={ClipboardScreen} />
      <Stack.Screen name="Files" component={Files} />
      <Stack.Screen name="Terminal" component={Terminal} />
      <Stack.Screen name="Apps" component={Apps} />
      <Stack.Screen name="Network" component={Network} />
      <Stack.Screen name="Control" component={Control} />
      <Stack.Screen name="Diagnostics" component={Diagnostics} />
      <Stack.Screen name="Rules" component={Rules} />
      <Stack.Screen name="SensorTuning" component={SensorTuning} />
    </Stack.Navigator>
  );
}

function Splash() {
  return (
    <View style={{ flex: 1, backgroundColor: C.canvas, alignItems: 'center', justifyContent: 'center' }}>
      <Image source={require('./assets/logo.png')} style={{ width: 92, height: 92 }} resizeMode="contain" />
    </View>
  );
}

// AppLock gates the app behind a biometric prompt on open + when returning from background,
// if "Require unlock on open" is enabled in Settings.
function AppLock({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState<boolean | null>(null); // null = still reading the setting
  const busy = useRef(false);

  const unlock = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!(await biometricAvailable())) { setLocked(false); return; }
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Sentivo', fallbackLabel: 'Use device PIN', cancelLabel: 'Cancel' });
      if (res.success) setLocked(false);
    } catch {} finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    (async () => {
      if ((await storeGet('appLock')) !== '1') { setLocked(false); return; }
      setLocked(true);
      unlock();
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s !== 'active' && (await storeGet('appLock')) === '1') setLocked(true);
    });
    return () => sub.remove();
  }, []);

  if (locked === null) return <Splash />;
  if (locked) {
    return (
      <View style={{ flex: 1, backgroundColor: C.canvas, alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <Image source={require('./assets/logo.png')} style={{ width: 92, height: 92 }} resizeMode="contain" />
        <Pressable onPress={unlock} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.dark, paddingHorizontal: 26, paddingVertical: 15, borderRadius: 16 }}>
          <LockKey size={20} color="#fff" weight="bold" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Unlock Sentivo</Text>
        </Pressable>
      </View>
    );
  }
  return <>{children}</>;
}

function Root() {
  const { paired, booting } = useConn();
  if (booting) return <Splash />; // avoid flashing the login page before stored creds load
  return paired ? <AppLock><Main /></AppLock> : <Connect />;
}

export default function App() {
  const [loaded] = useFonts({
    'Chillax-Extralight': require('./assets/fonts/Chillax-Extralight.ttf'),
    'Chillax-Light': require('./assets/fonts/Chillax-Light.ttf'),
    'Chillax-Regular': require('./assets/fonts/Chillax-Regular.ttf'),
    'Chillax-Medium': require('./assets/fonts/Chillax-Medium.ttf'),
    'Chillax-Semibold': require('./assets/fonts/Chillax-Semibold.ttf'),
    'Chillax-Bold': require('./assets/fonts/Chillax-Bold.ttf'),
  });
  // default the whole app to portrait; the live Screen unlocks to landscape while streaming
  useEffect(() => { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); }, []);
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <ConnProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar hidden />
          <Root />
          <ClipSnack />
          <Toast />
          <Notifier />
        </NavigationContainer>
      </ConnProvider>
    </SafeAreaProvider>
  );
}
