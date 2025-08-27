import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {launchImageLibrary} from 'react-native-image-picker';
import QRCode from 'react-native-qrcode-svg';
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
} from 'react-native-vision-camera';
import {WebView} from 'react-native-webview';
import {io} from 'socket.io-client';

const {width: screenWidth} = Dimensions.get('window');
const CHAT_SERVER = 'http://192.168.29.24:3000'; // Android emulator default; replace with LAN IP on device

const defaultAvatars = [
  'https://i.pravatar.cc/150?img=1',
  'https://i.pravatar.cc/150?img=2',
  'https://i.pravatar.cc/150?img=3',
  'https://i.pravatar.cc/150?img=4',
  'https://i.pravatar.cc/150?img=5',
  'https://i.pravatar.cc/150?img=6',
  'https://i.pravatar.cc/150?img=7',
  'https://i.pravatar.cc/150?img=8',
  'https://i.pravatar.cc/150?img=9',
  'https://i.pravatar.cc/150?img=10',
  'https://i.pravatar.cc/150?img=11',
  'https://i.pravatar.cc/150?img=12',
];

const defaultRoomLogos = [
  'https://flagcdn.com/w80/us.png', // United States
  'https://flagcdn.com/w80/in.png', // India
  'https://flagcdn.com/w80/gb.png', // United Kingdom
  'https://flagcdn.com/w80/jp.png', // Japan
  'https://flagcdn.com/w80/de.png', // Germany
  'https://flagcdn.com/w80/fr.png', // France
  'https://flagcdn.com/w80/br.png', // Brazil
  'https://flagcdn.com/w80/au.png', // Australia
];

const FALLBACK_LOGO =
  'https://ideogram.ai/assets/image/lossless/response/SeDPkeIrRCaUBXIDNjBv9A';
const getFallbackLogoForRoom = () => FALLBACK_LOGO;

export default function ChatApp({navigation}) {
  const [step, setStep] = useState(''); // profile | lobby | chat
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(defaultAvatars[0]);
  const [customAvatar, setCustomAvatar] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomLogo, setRoomLogo] = useState(defaultRoomLogos[0]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typingUsers, setTypingUsers] = useState({});
  const [, setTypingTimers] = useState({});
  const [, setPresence] = useState([]);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [roomHistory, setRoomHistory] = useState([]);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [showRoomLogoPicker, setShowRoomLogoPicker] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [gifModalVisible, setGifModalVisible] = useState(false);

  const socketRef = useRef(null);
  const cameraDevice = useCameraDevice('back');
  const flatListRef = useRef(null);
  const webViewRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem('chat.profile');
        if (saved) {
          const p = JSON.parse(saved);
          setName(p.name || '');
          setAvatarUrl(p.avatarUrl || defaultAvatars[0]);
          setCustomAvatar(p.customAvatar || null);
          setStep('lobby');
        } else {
          setStep('profile');
        }

        const history = await AsyncStorage.getItem('chat.roomHistory');
        if (history) {
          const parsed = JSON.parse(history) || [];
          const normalized = parsed.map(r => ({
            ...r,
            logo: r.logo || getFallbackLogoForRoom(r.id),
          }));
          setRoomHistory(normalized);
          if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
            await AsyncStorage.setItem(
              'chat.roomHistory',
              JSON.stringify(normalized),
            );
          }
        }
      } catch {}
    })();
  }, []);

  const profile = useMemo(
    () => ({
      name: name.trim() || 'Anonymous',
      avatarUrl: customAvatar || avatarUrl,
    }),
    [name, avatarUrl, customAvatar],
  );

  const isGifUrl = text => {
    if (typeof text !== 'string') return false;
    const lower = text.toLowerCase();
    return (
      (lower.startsWith('http://') || lower.startsWith('https://')) &&
      lower.includes('.gif')
    );
  };

  const connectSocket = () => {
    if (socketRef.current) return socketRef.current;
    const s = io(CHAT_SERVER, {transports: ['websocket']});
    socketRef.current = s;

    s.on('connect_error', e => Alert.alert('Socket Error', e.message));
    s.on('message', msg => {
      setMessages(prev => {
        const newMessages = [...prev, msg];
        setTimeout(() => {
          if (flatListRef.current) {
            flatListRef.current.scrollToEnd({animated: true});
          }
        }, 100);
        return newMessages;
      });
    });
    s.on('typing', ({typing, profile: p}) => {
      setTypingUsers(prev => {
        const next = {...prev};
        if (typing) {
          next[p.name] = true;
          setTypingTimers(prevTimers => {
            const newTimers = {...prevTimers};
            if (newTimers[p.name]) clearTimeout(newTimers[p.name]);
            newTimers[p.name] = setTimeout(() => {
              setTypingUsers(prevUsers => {
                const updated = {...prevUsers};
                delete updated[p.name];
                return updated;
              });
            }, 2000);
            return newTimers;
          });
        } else {
          delete next[p.name];
          setTypingTimers(prevTimers => {
            const newTimers = {...prevTimers};
            if (newTimers[p.name]) {
              clearTimeout(newTimers[p.name]);
              delete newTimers[p.name];
            }
            return newTimers;
          });
        }
        return next;
      });
    });
    s.on('presence:update', users => setPresence(users));
    return s;
  };

  const addToRoomHistory = async (id, name, logo, isCreated = false) => {
    const finalLogo = logo || getFallbackLogoForRoom(id);
    const newRoom = {
      id,
      name: name || `Room ${id}`,
      logo: finalLogo,
      isCreated,
      lastJoined: new Date().toISOString(),
    };

    const updatedHistory = [
      newRoom,
      ...roomHistory.filter(room => room.id !== id),
    ].slice(0, 10);

    setRoomHistory(updatedHistory);
    await AsyncStorage.setItem(
      'chat.roomHistory',
      JSON.stringify(updatedHistory),
    );
  };

  const joinRoom = async (id, name = '', logo = '') => {
    if (!id) return Alert.alert('Enter room id');
    const s = connectSocket();
    await new Promise(resolve =>
      s.emit('join', {roomId: id, profile}, resolve),
    );
    const finalLogo = logo || getFallbackLogoForRoom(id);
    setRoomId(id);
    setRoomName(name || `Room ${id}`);
    setRoomLogo(finalLogo);
    await addToRoomHistory(id, name, finalLogo, false);
    setStep('chat');
  };

  const createRoom = async () => {
    if (!roomName.trim()) {
      Alert.alert('Please enter a room name');
      return;
    }

    const id = Math.random().toString(36).slice(2, 8).toUpperCase();
    const finalLogo = roomLogo || getFallbackLogoForRoom(id);
    await addToRoomHistory(id, roomName.trim(), finalLogo, true);
    await joinRoom(id, roomName.trim(), finalLogo);
    setRoomName('');
    setRoomLogo(defaultRoomLogos[0]);
    setShowCreateRoom(false);
  };

  const sendRawTextMessage = text => {
    const clean = (text || '').trim();
    if (!clean) return;
    const msg = {roomId, message: {text: clean, profile, tempId: Date.now()}};
    const s = connectSocket();
    s.emit('message', msg, () => {});
    setTimeout(() => {
      if (flatListRef.current) {
        flatListRef.current.scrollToEnd({animated: true});
      }
    }, 100);
  };

  const sendMessage = async() => {
    const text = input.trim();
    if (!text) return;
    sendRawTextMessage(text);
    await new Promise((resolve, reject) => {
      setInput(''); 
    })
  };

  const sendGif = url => {
    if (!url) return;
    setGifModalVisible(false);
    sendRawTextMessage(url);
  };

  const onTyping = val => {
    setInput(val);
    const s = connectSocket();
    s.emit('typing', {roomId, typing: true, profile});
    clearTimeout(onTyping._t);
    onTyping._t = setTimeout(
      () => s.emit('typing', {roomId, typing: false, profile}),
      800,
    );
  };

  const pickCustomAvatar = () => {
    launchImageLibrary({mediaType: 'photo'}, response => {
      if (response?.assets?.[0]?.uri) {
        setCustomAvatar(response.assets[0].uri);
      }
    });
  };

  const saveProfile = async () => {
    await AsyncStorage.setItem('chat.profile', JSON.stringify(profile));
    setStep('lobby');
  };

  const scrollToBottom = () => {
    if (flatListRef.current) {
      flatListRef.current.scrollToEnd({animated: true});
    }
  };

  const handleScroll = event => {
    const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
    const paddingToBottom = 20;
    const isCloseToBottom =
      contentOffset.y + layoutMeasurement.height >=
      contentSize.height - paddingToBottom;

    setShowScrollButton(!isCloseToBottom);
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: codes => {
      const v = codes?.[0]?.value;
      if (!v) return;
      setScanning(false);
      joinRoom(v);
    },
  });

  const renderMessage = ({item}) => {
    const mine = item?.profile?.name === profile.name;
    const text = item?.text;
    const showGif = isGifUrl(text);
    return (
      <View style={[styles.msgRow, mine ? styles.msgRight : styles.msgLeft]}>
        {!mine && (
          <Image
            source={{uri: item?.profile?.avatarUrl}}
            style={styles.avatarSmall}
          />
        )}
        <View
          style={[
            styles.bubble,
            mine ? styles.bubbleSelf : styles.bubbleOther,
            !showGif ? styles.bubble : styles.gif,
          ]}>
          {!mine && <Text style={styles.nameText}>{item?.profile?.name}</Text>}
          {showGif ? (
            <View style={{flex: 1}}>
              <WebView
                source={{uri: text}}
                style={styles.gifWebView}
                scrollEnabled={false}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                bounces={false}
                overScrollMode="never"
                androidLayerType="hardware"
                javaScriptEnabled={false}
                domStorageEnabled={false}
                cacheEnabled={false}
                allowsInlineMediaPlayback={true}
                mediaPlaybackRequiresUserAction={false}
                pointerEvents="none"
                onTouchStart={() => {}}
                onTouchMove={() => {}}
                onTouchEnd={() => {}}
                onError={() => {
                  // Fallback to static image if WebView fails
                  return <Image source={{uri: text}} style={styles.gifImage} />;
                }}
                aria-disabled={true}
              />
              <View style={StyleSheet.absoluteFill} pointerEvents="box-only" />
            </View>
          ) : mine ? (
            <>
              <Text style={styles.msgText}>{text}</Text>
            </>
          ) : (
            <>
              <Text style={styles.othermsgText}>{text}</Text>
            </>
          )}
        </View>
        {mine && (
          <Image
            source={{uri: item?.profile?.avatarUrl}}
            style={styles.avatarSmall}
          />
        )}
      </View>
    );
  };

  const renderRoomItem = ({item}) => (
    <TouchableOpacity
      style={styles.roomItem}
      onPress={() => joinRoom(item.id, item.name, item.logo)}>
      <View style={styles.roomItemContent}>
        <Image source={{uri: item.logo}} style={styles.roomLogo} />
        <View style={styles.roomItemLeft}>
          <Text style={styles.roomName}>{item.name}</Text>
          <Text style={styles.roomId}>ID: {item.id}</Text>
        </View>
        <View style={styles.roomItemRight}>
          <Text style={styles.roomType}>
            {item.isCreated ? 'Created' : 'Joined'}
          </Text>
          <Text style={styles.roomDate}>
            {new Date(item.lastJoined).toLocaleDateString()}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (step === 'profile') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Set up your profile</Text>
        <View style={styles.profileRow}>
          <TouchableOpacity onPress={pickCustomAvatar}>
            <Image
              source={{uri: customAvatar || avatarUrl}}
              style={styles.avatar}
            />
          </TouchableOpacity>
          <View style={{flex: 1}}>
            <TextInput
              placeholder="Enter your name"
              placeholderTextColor="#94a3b8"
              value={name}
              onChangeText={setName}
              style={styles.input}
            />
            <Text style={styles.hint}>Tap avatar to choose photo</Text>
          </View>
        </View>

        <Text style={styles.subtitle}>Or pick a default avatar</Text>
        <View style={styles.avatarGrid}>
          {defaultAvatars.map((url, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => {
                setCustomAvatar(null);
                setAvatarUrl(url);
              }}>
              <Image
                source={{uri: url}}
                style={[
                  styles.avatarPick,
                  url === avatarUrl && styles.avatarPickActive,
                ]}
              />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={saveProfile}>
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (step === 'lobby') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Join or create a room</Text>

        {/* Create/Join Room */}
        <View style={styles.card}>
          {!showCreateRoom ? (
            <>
              <Text style={styles.label}>Room ID</Text>
              <TextInput
                placeholder="e.g. ABC123"
                placeholderTextColor="#94a3b8"
                value={roomId}
                onChangeText={setRoomId}
                style={styles.input}
              />
              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => joinRoom(roomId)}>
                  <Text style={styles.primaryButtonText}>Join</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setShowCreateRoom(true)}>
                  <Text style={styles.secondaryButtonText}>Create New</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={async () => {
                    const cam = await Camera.requestCameraPermission();
                    if (cam !== 'granted') {
                      Alert.alert('Camera permission required');
                      return;
                    }
                    setScanning(true);
                  }}>
                  <Text style={styles.secondaryButtonText}>Scan</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Room Name</Text>
              <TextInput
                placeholder="Enter room name"
                placeholderTextColor="#94a3b8"
                value={roomName}
                onChangeText={setRoomName}
                style={styles.input}
              />

              <Text style={styles.label}>Room Logo</Text>
              <TouchableOpacity
                style={styles.roomLogoSelector}
                onPress={() => setShowRoomLogoPicker(!showRoomLogoPicker)}>
                <Image
                  source={{uri: roomLogo}}
                  style={styles.roomLogoPreview}
                />
                <Text style={styles.roomLogoText}>Tap to change logo</Text>
              </TouchableOpacity>

              {showRoomLogoPicker && (
                <View style={styles.roomLogoGrid}>
                  {defaultRoomLogos.map((url, i) => (
                    <TouchableOpacity
                      key={i}
                      onPress={() => {
                        setRoomLogo(url);
                        setShowRoomLogoPicker(false);
                      }}>
                      <Image
                        source={{uri: url}}
                        style={[
                          styles.roomLogoPick,
                          url === roomLogo && styles.roomLogoPickActive,
                        ]}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={createRoom}>
                  <Text style={styles.primaryButtonText}>Create Room</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setShowCreateRoom(false)}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {scanning && (
          <View style={styles.cameraWrap}>
            {cameraDevice ? (
              <Camera
                style={styles.camera}
                device={cameraDevice}
                isActive={true}
                codeScanner={codeScanner}
              />
            ) : (
              <Text style={styles.hint}>Opening camera…</Text>
            )}
            <TouchableOpacity
              style={[styles.secondaryButton, {marginVertical: 10}]}
              onPress={() => setScanning(false)}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Room History */}
        {roomHistory.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Rooms</Text>
            <FlatList
              data={roomHistory}
              renderItem={renderRoomItem}
              keyExtractor={item => item.id}
              style={styles.roomList}
              showsVerticalScrollIndicator={false}
            />
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={{uri: roomLogo}} style={styles.avatarSmall} />
          <Text
            ellipsizeMode="tail"
            numberOfLines={1}
            style={styles.headerTitle}>
            {roomName || `Room ${roomId}`}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.fab}
            onPress={() => setInviteVisible(v => !v)}>
            <Text style={styles.fabText}>Invite</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.file}
            onPress={() => navigation.navigate('MultipleFileShare')}>
            <Text style={styles.fabText}>File Share</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.headerMeta}>Room ID</Text>
          <Text
            style={styles.headerId}
            numberOfLines={1}
            ellipsizeMode="middle">
            {roomId}
          </Text>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item, idx) =>
          String(item.serverTs || item.tempId || idx)
        }
        renderItem={renderMessage}
        contentContainerStyle={{padding: 16}}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
      />

      {showScrollButton && (
        <TouchableOpacity
          style={styles.scrollToBottomButton}
          onPress={scrollToBottom}>
          <Text style={styles.scrollToBottomText}>↓</Text>
        </TouchableOpacity>
      )}

      <View style={styles.typingBar}>
        {!!Object.keys(typingUsers).length && (
          <Text style={styles.hint}>
            {Object.keys(typingUsers).join(', ')} typing…
          </Text>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.gifButton}
            onPress={() => setGifModalVisible(true)}>
            <Text style={styles.gifButtonText}>GIF</Text>
          </TouchableOpacity>
          <TextInput
            value={input}
            onChangeText={onTyping}
            placeholder="Message"
            placeholderTextColor="#94a3b8"
            style={styles.inputFlex}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={sendMessage}>
            <Text style={styles.primaryButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {inviteVisible && (
        <View style={styles.inviteCard}>
          <Text style={styles.subtitle}>Invite with QR</Text>
          <Text style={styles.roomInfo}>Room Name: {roomName}</Text>
          <Text style={styles.roomInfo}>Room ID: {roomId}</Text>
          <View style={{alignItems: 'center', marginVertical: 12}}>
            <QRCode
              value={roomId}
              size={200}
              quietZone={8}
              logo={{uri: FALLBACK_LOGO}}
              enableLinearGradient={true}
              linearGradient={['#38d39f', '#1A07F0']}
              logoBorderRadius={10}
            />
          </View>
          <TouchableOpacity
            style={[styles.secondaryButton, {marginVertical: 10}]}
            onPress={() => setInviteVisible(false)}>
            <Text style={styles.secondaryButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal
        visible={gifModalVisible}
        animationType="slide"
        onRequestClose={() => setGifModalVisible(false)}>
        <View style={styles.gifModalContainer}>
          <View style={styles.gifModalHeader}>
            <Text style={styles.gifModalTitle}>Search GIFs</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setGifModalVisible(false)}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
          <WebView
            ref={webViewRef}
            source={{uri: 'https://giphy.com/search'}}
            style={styles.webView}
            onMessage={event => {
              try {
                const data = JSON.parse(event.nativeEvent.data);
                if (data.type === 'gif_selected' && data.url) {
                  sendGif(data.url);
                }
              } catch (e) {
                // Ignore parsing errors
              }
            }}
            injectedJavaScript={`
              // Inject script to detect GIF clicks and send to React Native
              (function() {
                // Listen for clicks on GIF images
                document.addEventListener('click', function(e) {
                  if (e.target.tagName === 'IMG' && e.target.src.includes('.gif')) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'gif_selected',
                      url: e.target.src
                    }));
                  }
                });
                
                // Also listen for clicks on GIF containers
                document.addEventListener('click', function(e) {
                  const gifContainer = e.target.closest('[data-gif-url]');
                  if (gifContainer) {
                    const gifUrl = gifContainer.getAttribute('data-gif-url');
                    if (gifUrl && gifUrl.includes('.gif')) {
                      window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: 'gif_selected',
                        url: gifUrl
                      }));
                    }
                  }
                });
              })();
            `}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0b0c10', padding: 16},
  title: {color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 12},
  subtitle: {color: '#e5e7eb', fontSize: 16, marginTop: 12},
  section: {marginBottom: 20},
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  headerActions: {flexDirection: 'row', alignItems: 'center', gap: 8},
  headerRight: {
    alignItems: 'flex-start',
    maxWidth: screenWidth * 0.35,
    marginLeft: 10,
  },
  headerTitle: {color: '#fff', fontSize: 14, fontWeight: '700', flexShrink: 1},
  headerMeta: {color: '#9aa0a6', fontSize: 10},
  headerId: {color: '#e5e7eb', fontSize: 12},
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginVertical: 12,
  },
  avatar: {width: 72, height: 72, borderRadius: 36, backgroundColor: '#1f2937'},
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1f2937',
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginVertical: 12,
  },
  avatarPick: {width: 52, height: 52, borderRadius: 26, margin: 4},
  avatarPickActive: {borderWidth: 3, borderColor: '#38d39f'},
  input: {
    backgroundColor: '#14161b',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputFlex: {
    flex: 1,
    backgroundColor: '#14161b',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginRight: 8,
  },
  row: {flexDirection: 'row', gap: 12, marginTop: 12, alignItems: 'center'},
  card: {backgroundColor: '#14161b', borderRadius: 16, padding: 16},
  primaryButton: {
    backgroundColor: '#38d39f',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  primaryButtonText: {color: '#0b0c10', fontWeight: '700'},
  secondaryButton: {
    borderColor: '#38d39f',
    borderWidth: 2,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  secondaryButtonText: {color: '#38d39f', fontWeight: '700'},
  hint: {color: '#94a3b8', marginTop: 6},
  msgRow: {flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12},
  msgLeft: {justifyContent: 'flex-start'},
  msgRight: {justifyContent: 'flex-end'},
  bubble: {maxWidth: screenWidth * 0.7, padding: 12, borderRadius: 14},
  gif: {maxWidth: screenWidth * 0.7, padding: 5, borderRadius: 10},
  bubbleSelf: {backgroundColor: '#38d39f'},
  bubbleOther: {backgroundColor: '#5438D3'},
  othermsgText: {color: '#E1E1E6', fontWeight: '600'},
  msgText: {color: '#0b0c10', fontWeight: '600'},
  nameText: {color: '#F5F7F9', marginBottom: 4},
  gifImage: {
    width: 220,
    height: 220,
    borderRadius: 8,
    backgroundColor: '#0b0c10',
  },
  gifWebView: {
    width: 220,
    height: 220,
    borderRadius: 8,
    backgroundColor: '#0b0c10',
  },
  typingBar: {minHeight: 20, paddingHorizontal: 8},
  inputBar: {flexDirection: 'row', alignItems: 'center', paddingVertical: 8},
  inviteCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 100,
    backgroundColor: '#14161b',
    borderRadius: 16,
    padding: 16,
    elevation: 10,
  },
  roomInfo: {color: '#e5e7eb', textAlign: 'center', marginBottom: 8},
  cameraWrap: {marginTop: 16, alignItems: 'center'},
  camera: {width: '100%', height: 260, borderRadius: 12},
  fab: {
    backgroundColor: '#277EF8',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
  },
  file: {
    backgroundColor: '#F12821',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
  },
  gifButton: {
    backgroundColor: '#6b7280',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginRight: 8,
  },
  gifButtonText: {color: '#fff', fontWeight: '700'},
  fabText: {color: '#fff', fontWeight: '700', fontSize: 12},
  roomList: {},
  roomItem: {
    backgroundColor: '#14161b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  roomItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  roomLogo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1f2937',
  },
  roomItemLeft: {flex: 1},
  roomItemRight: {alignItems: 'flex-end'},
  roomName: {color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4},
  roomId: {color: '#94a3b8', fontSize: 14},
  roomType: {
    color: '#38d39f',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  roomDate: {color: '#94a3b8', fontSize: 12},
  label: {color: '#e5e7eb', fontSize: 16, marginBottom: 8, fontWeight: '600'},
  roomLogoSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1f2937',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  roomLogoPreview: {width: 48, height: 48, borderRadius: 24},
  roomLogoText: {color: '#94a3b8', fontSize: 14},
  roomLogoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  roomLogoPick: {width: 52, height: 52, borderRadius: 26, margin: 4},
  roomLogoPickActive: {borderWidth: 3, borderColor: '#38d39f'},
  scrollToBottomButton: {
    position: 'absolute',
    right: 20,
    bottom: 100,
    backgroundColor: '#38d39f',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  scrollToBottomText: {
    color: '#0b0c10',
    fontSize: 20,
    fontWeight: 'bold',
  },
  gifModalContainer: {flex: 1, backgroundColor: '#0b0c10'},
  gifModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  gifModalTitle: {color: '#fff', fontSize: 18, fontWeight: '700'},
  closeButton: {
    backgroundColor: '#374151',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {color: '#fff', fontSize: 16, fontWeight: 'bold'},
  webView: {flex: 1},
});
