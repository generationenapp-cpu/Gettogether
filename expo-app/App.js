// =============================================================
//  GetTogether – appen (Expo)
//
//  Guiden og fællesskabet er bygget ind i appen (web/sider.js) og vises,
//  som om de lå på hjemmesiden, så login, database og opkald virker
//  præcis som på nettet. Appen lægger det oven i, som kun en rigtig app kan:
//    - push-beskeder ved nye beskeder, opkald og venneanmodninger
//    - tryk på en push-besked åbner den rigtige chat eller opkaldet
//    - Android-tilbageknap, tastatur, farver i status- og navigationslinjen
//    - kopiér koden, gem "mine data", links åbner i en browser ovenpå
// =============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import SIDER from './web/sider';

const SITE = (Constants.expoConfig?.extra?.site || 'https://gettogether-by-malik.netlify.app').replace(/\/+$/, '');
const BASE = { guide: SITE + '/', faelles: SITE + '/faellesskab/' };
const MORK = '#0B1220';
const GULD = '#D4AF6A';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Mens appen er åben, viser fællesskabet selv nye beskeder og opkald
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
});

// Lille script, der kører i siden: sender sidens farver til appen, så status- og
// navigationslinjen altid passer (lys/mørk, opkaldsskærm osv.)
const BRO = `(function(){
  if (window.__GT_BRO) return; window.__GT_BRO = true;
  window.GT_APP = { platform: ${JSON.stringify(Platform.OS)} };
  function post(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch(e){} }
  function farve(sel){ var el = document.querySelector(sel); if (!el) return null; var c = getComputedStyle(el).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent' ? c : null; }
  var sidst = '', t = null;
  function tema(){
    if (!document.body) return;
    var bg = getComputedStyle(document.body).backgroundColor || '${MORK}';
    var opkald = document.querySelector('#call.open');
    var top = opkald ? '${MORK}' : (farve('#app header') || bg);
    var bund = opkald ? '${MORK}' : (farve('#app nav') || bg);
    var s = top + '|' + bund + '|' + bg;
    if (s !== sidst){ sidst = s; post({ type:'theme', top:top, bottom:bund, bg:bg }); }
  }
  function snart(){ clearTimeout(t); t = setTimeout(tema, 80); }
  function start(){
    tema();
    new MutationObserver(snart).observe(document.documentElement, { attributes:true, childList:true, subtree:true, attributeFilter:['class','data-theme','hidden'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', snart); } catch(e){}
})(); true;`;

function erMoerk(farve) {
  const s = String(farve || '');
  let r, g, b;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  if (m) [r, g, b] = m.slice(1).map(Number);
  else if (/^#[0-9a-f]{6}$/i.test(s)) [r, g, b] = [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  else return true;
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

async function hentPushToken() {
  try {
    if (!Device.isDevice) return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('beskeder', {
        name: 'Beskeder', importance: Notifications.AndroidImportance.HIGH, lightColor: GULD,
      });
      await Notifications.setNotificationChannelAsync('opkald', {
        name: 'Opkald', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 400, 200, 400, 200, 400], lightColor: GULD,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data || null;
  } catch (e) {
    return null;   // fx i Expo Go eller uden Firebase-opsætning – appen virker stadig
  }
}

async function gemOgDel(navn, tekst) {
  try {
    const fil = new File(Paths.cache, String(navn || 'gettogether.json').replace(/[^\w.-]/g, '_'));
    if (fil.exists) fil.delete();
    fil.create();
    fil.write(String(tekst ?? ''));
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fil.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Gem dine data' });
    }
  } catch (e) {}
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Skal />
    </SafeAreaProvider>
  );
}

function Skal() {
  const insets = useSafeAreaInsets();
  const web = useRef(null);
  const [side, setSide] = useState('guide');            // 'guide' eller 'faelles'
  const [genstart, setGenstart] = useState(0);          // genindlæs siden, hvis den går ned
  const [farver, setFarver] = useState({ top: MORK, bottom: MORK, bg: MORK });
  const [tastatur, setTastatur] = useState(0);
  const [hoejde, setHoejde] = useState({ fuld: 0, nu: 0 });
  const sideRef = useRef(side);
  sideRef.current = side;
  const logget = useRef(false);                          // logget ind i fællesskabet
  const ventende = useRef(null);                         // åbn chat/opkald, når fællesskabet er klar
  const token = useRef(null);
  const behandlet = useRef(null);

  const kilde = useMemo(() => ({ html: SIDER[side], baseUrl: BASE[side] }), [side]);
  const koer = useCallback(js => { web.current?.injectJavaScript(`try{${js}}catch(e){};true;`); }, []);

  const skift = useCallback(ny => {
    if (ny === sideRef.current) return;
    logget.current = false;
    setSide(ny);
  }, []);

  const aabnUdefra = useCallback(url => {
    if (/^https?:/i.test(url)) WebBrowser.openBrowserAsync(url, { controlsColor: GULD, toolbarColor: MORK }).catch(() => Linking.openURL(url).catch(() => {}));
    else Linking.openURL(url).catch(() => {});
  }, []);

  const aabnFraPush = useCallback(data => {
    if (!data || !data.kind) return;
    const v = { kind: data.kind, id: data.id ?? null };
    if (sideRef.current === 'faelles' && logget.current) koer(`window.GT_NAV&&window.GT_NAV(${JSON.stringify(v.kind)},${JSON.stringify(v.id)})`);
    else { ventende.current = v; skift('faelles'); }
  }, [koer, skift]);

  // Hvilke adresser bliver i appen, og hvilke åbnes i en browser
  const vejvalg = useCallback(req => {
    const url = req.url || '';
    if (/^(about:|data:|blob:|javascript:)/i.test(url)) return true;
    if (req.isTopFrame === false) return true;
    const uden = url.split('#')[0];
    if (uden === BASE[sideRef.current]) return true;
    if (uden.startsWith(SITE + '/')) {
      const sti = uden.slice(SITE.length).split('?')[0];
      if (sti === '/faellesskab/' || sti === '/faellesskab/index.html') { skift('faelles'); return false; }
      if (sti === '/' || sti === '/index.html') { skift('guide'); return false; }
    }
    if (/^(https?|mailto|tel|sms):/i.test(url)) aabnUdefra(url);
    return false;
  }, [skift, aabnUdefra]);

  const onMessage = useCallback(async e => {
    let m;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    switch (m && m.type) {
      case 'theme':
        setFarver({ top: m.top || MORK, bottom: m.bottom || MORK, bg: m.bg || MORK });
        break;
      case 'signed-in': {
        logget.current = true;
        if (!token.current) token.current = await hentPushToken();
        if (token.current) koer(`window.GT_PUSH_TOKEN&&window.GT_PUSH_TOKEN(${JSON.stringify(token.current)},${JSON.stringify(Platform.OS)})`);
        if (ventende.current) {
          const v = ventende.current; ventende.current = null;
          koer(`window.GT_NAV&&window.GT_NAV(${JSON.stringify(v.kind)},${JSON.stringify(v.id)})`);
        }
        break;
      }
      case 'signed-out':
        logget.current = false;
        break;
      case 'copy':
        Clipboard.setStringAsync(String(m.text ?? '')).catch(() => {});
        break;
      case 'download':
        gemOgDel(m.name, m.data);
        break;
      case 'back':
        if (!m.handled) {
          if (sideRef.current === 'faelles') skift('guide');
          else BackHandler.exitApp();
        }
        break;
    }
  }, [koer, skift]);

  // Tryk på en push-besked (også når appen var lukket)
  const svar = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!svar) return;
    const id = svar.notification.request.identifier;
    if (behandlet.current === id) return;
    behandlet.current = id;
    aabnFraPush(svar.notification.request.content.data);
    if (Notifications.clearLastNotificationResponseAsync) Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, [svar, aabnFraPush]);

  // Android: tilbage-knappen lukker det øverste i siden, ellers går den til guiden / lukker appen
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      koer(`var h=false;try{h=!!(window.GT_BACK&&window.GT_BACK())}catch(e){};window.ReactNativeWebView.postMessage(JSON.stringify({type:'back',handled:h}))`);
      return true;
    });
    return () => sub.remove();
  }, [koer]);

  // Android: gør plads til tastaturet (Android tegner appen under tastaturet)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const a = Keyboard.addListener('keyboardDidShow', ev => setTastatur(ev.endCoordinates?.height || 0));
    const b = Keyboard.addListener('keyboardDidHide', () => setTastatur(0));
    return () => { a.remove(); b.remove(); };
  }, []);

  // Tilbage i appen: hent det, man gik glip af (fx et opkald)
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active' && sideRef.current === 'faelles' && logget.current) koer('window.GT_RESUME&&window.GT_RESUME()');
    });
    return () => sub.remove();
  }, [koer]);

  // Startskærmen forsvinder, når siden er klar (eller efter 5 sekunder)
  useEffect(() => {
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 5000);
    return () => clearTimeout(t);
  }, []);

  // iPhone: siden bruger selv hele skærmen (safe-area i CSS). Android: appen holder kanterne fri.
  const android = Platform.OS === 'android';
  const systemTastatur = Math.max(0, hoejde.fuld - hoejde.nu);   // hvis Android selv har gjort plads
  const ekstra = android && tastatur ? Math.max(0, tastatur - systemTastatur) : 0;
  // React Native måler tastaturet uden navigationslinjen, så den lægges oveni
  const bund = ekstra ? ekstra + insets.bottom : insets.bottom;

  return (
    <View
      style={[styles.rod, { backgroundColor: farver.bg }]}
      onLayout={ev => {
        const h = ev.nativeEvent.layout.height;
        setHoejde(x => ({ fuld: tastatur ? x.fuld || h : h, nu: h }));
      }}
    >
      <StatusBar style={erMoerk(farver.top) ? 'light' : 'dark'} />
      {android && <View style={{ height: insets.top, backgroundColor: farver.top }} />}
      <WebView
        key={side + genstart}
        ref={web}
        style={[styles.web, { backgroundColor: farver.bg }]}
        source={kilde}
        originWhitelist={['*']}
        injectedJavaScriptBeforeContentLoaded={BRO}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={vejvalg}
        onOpenWindow={ev => aabnUdefra(ev.nativeEvent.targetUrl)}
        onLoadEnd={() => SplashScreen.hideAsync().catch(() => {})}
        onRenderProcessGone={() => setGenstart(n => n + 1)}
        onContentProcessDidTerminate={() => setGenstart(n => n + 1)}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        allowsBackForwardNavigationGestures={false}
        allowsLinkPreview={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        keyboardDisplayRequiresUserAction={false}
        bounces={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        applicationNameForUserAgent="GetTogetherApp/1.0"
        webviewDebuggingEnabled={__DEV__}
      />
      {android && <View style={{ height: bund, backgroundColor: ekstra ? farver.bg : farver.bottom }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  rod: { flex: 1 },
  web: { flex: 1 },
});
