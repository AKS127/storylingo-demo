import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  Linking,
  Modal,
  Text,
  Image,
  ImageBackground,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius, StoryBuddyColors, Typography } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { getApiUrl } from "@/lib/query-client";
import { useLanguage, getStoryTranslation } from "@/context/LanguageContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { useProgress, ConversationMessage } from "@/context/ProgressContext";

type SessionStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "error";


function TrialPromptModal({ visible, onStartTrial, onDismiss }: { 
  visible: boolean; 
  onStartTrial: () => void; 
  onDismiss: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={modalStyles.overlay}>
        <View style={modalStyles.content}>
          <View style={modalStyles.iconContainer}>
            <Feather name="gift" size={40} color={StoryBuddyColors.primary} />
          </View>
          
          <Text style={modalStyles.title}>Enjoying the Story?</Text>
          <Text style={modalStyles.subtitle}>
            Get 30 days free when you subscribe!
          </Text>
          
          <View style={modalStyles.features}>
            <View style={modalStyles.featureRow}>
              <Feather name="check" size={16} color={StoryBuddyColors.success} />
              <Text style={modalStyles.featureText}>Unlimited stories</Text>
            </View>
            <View style={modalStyles.featureRow}>
              <Feather name="check" size={16} color={StoryBuddyColors.success} />
              <Text style={modalStyles.featureText}>All story collections</Text>
            </View>
            <View style={modalStyles.featureRow}>
              <Feather name="check" size={16} color={StoryBuddyColors.success} />
              <Text style={modalStyles.featureText}>Cancel anytime</Text>
            </View>
          </View>
          
          <Pressable style={modalStyles.button} onPress={onStartTrial}>
            <Text style={modalStyles.buttonText}>Start 30-Day Free Trial</Text>
          </Pressable>
          
          <Pressable style={modalStyles.dismissButton} onPress={onDismiss}>
            <Text style={modalStyles.dismissText}>Maybe Later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function SessionScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Session">>();
  const { story } = route.params;
  const { language, t } = useLanguage();
  const { 
    hasActiveSubscription, 
    addListenTime,
    dailyLimitReached,
    dailyLimitSeconds,
    dailyListenTimeSeconds,
    status: subscriptionStatus,
  } = useSubscription();

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isHolding, setIsHolding] = useState(false); // true while child holds the mic button
  const [isPaused, setIsPaused] = useState(false);
  const [displayRemainingSeconds, setDisplayRemainingSeconds] = useState(
    Math.max(0, dailyLimitSeconds - dailyListenTimeSeconds)
  );

  const listenTimeRef = useRef(0);
  const listenIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const dailyLimitCheckedRef = useRef(false);
  
  // Daily limit only applies to free trial (before signing up for any plan)
  const isFreeTrial = subscriptionStatus === 'free_trial';
  const isLowTime = displayRemainingSeconds < 180; // Less than 3 minutes

  const { addSession, markStoryCompleted, saveTranscript } = useProgress();

  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextAudioTimeRef = useRef<number>(0);
  const isSendingAudioRef = useRef<boolean>(false);

  const transcriptRef = useRef<ConversationMessage[]>([]);
  const currentAITextRef = useRef<string>('');
  const userTurnCountRef = useRef(0);

  const talkButtonScale = useSharedValue(1);
  const pulseScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
      if (audioContextRef.current) audioContextRef.current.close();
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (listenIntervalRef.current) clearInterval(listenIntervalRef.current);
    };
  }, []);

  // Track listen time when connecting or session is active
  useEffect(() => {
    const isTracking = (status === 'connecting' || isSessionActive) && !isPaused;
    
    if (isTracking) {
      listenIntervalRef.current = setInterval(() => {
        listenTimeRef.current += 1;
        
        // Update display countdown for trial users
        if (isFreeTrial) {
          const totalToday = dailyListenTimeSeconds + listenTimeRef.current;
          const remaining = Math.max(0, dailyLimitSeconds - totalToday);
          setDisplayRemainingSeconds(remaining);
        }
        
        // Save listen time every 10 seconds
        if (listenTimeRef.current % 10 === 0) {
          addListenTime(10);
        }
        
        // Check if daily limit reached (only for trial users)
        if (isFreeTrial && !dailyLimitCheckedRef.current) {
          const totalToday = dailyListenTimeSeconds + listenTimeRef.current;
          if (totalToday >= dailyLimitSeconds) {
            dailyLimitCheckedRef.current = true;
            // Stop the session and show paywall
            if (listenIntervalRef.current) {
              clearInterval(listenIntervalRef.current);
            }
            stopSession();
            navigation.navigate('Paywall', { fromDailyLimit: true });
          }
        }
      }, 1000);
    } else {
      if (listenIntervalRef.current) {
        clearInterval(listenIntervalRef.current);
        listenIntervalRef.current = null;
      }
    }

    return () => {
      if (listenIntervalRef.current) {
        clearInterval(listenIntervalRef.current);
      }
    };
  }, [status, isSessionActive, isPaused, isFreeTrial, dailyListenTimeSeconds, dailyLimitSeconds]);

  const startPulseAnimation = useCallback(() => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.6, { duration: 800 }),
        withTiming(0.2, { duration: 800 })
      ),
      -1,
      true
    );
  }, []);

  const stopPulseAnimation = useCallback(() => {
    cancelAnimation(pulseScale);
    cancelAnimation(glowOpacity);
    pulseScale.value = withSpring(1);
    glowOpacity.value = withTiming(0);
  }, []);

  const talkButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: talkButtonScale.value }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: glowOpacity.value,
  }));

  // Decode base64 PCM16 and schedule playback via AudioContext
  const playAudioChunk = useCallback((base64: string) => {
    const audioCtx = audioContextRef.current;
    if (!audioCtx) return;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
      const buffer = audioCtx.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      if (nextAudioTimeRef.current < now) nextAudioTimeRef.current = now;
      src.start(nextAudioTimeRef.current);
      nextAudioTimeRef.current += buffer.duration;
    } catch (e) {
      console.error("Audio decode error:", e);
    }
  }, []);

  const connectToRealtimeWeb = useCallback(async () => {
    try {
      setStatus("connecting");

      // Step 1: Get ephemeral token from our backend
      const baseUrl = getApiUrl();
      const tokenUrl = new URL("/api/token", baseUrl);
      const response = await fetch(tokenUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyId: story.id,
          storyTitle: story.title,
          storyContext: story.context,
          macroBeats: story.macroBeats,
          language: language,
          isInteractive: story.isInteractive || false,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Token error:", errorData);
        throw new Error("Failed to get token");
      }

      const { client_secret } = await response.json();

      // Step 2: Microphone access
      let ms: MediaStream;
      try {
        ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micError: any) {
        setStatus("idle");
        const isDenied = micError?.name === "NotAllowedError" || micError?.name === "PermissionDeniedError";
        Alert.alert(
          "Microphone Required",
          isDenied
            ? "Microphone access was denied. Please allow microphone access in your browser settings, then tap the play button again."
            : "Could not access your microphone. Please check that your device has a working microphone and try again.",
          [{ text: "OK" }]
        );
        return;
      }
      localStreamRef.current = ms;

      // Step 3: AudioContext for mic capture (PCM16 @ 24kHz) and audio playback
      const audioCtx = new (window.AudioContext as any)({ sampleRate: 24000 });
      audioContextRef.current = audioCtx;
      nextAudioTimeRef.current = 0;

      const source = audioCtx.createMediaStreamSource(ms);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      scriptProcessorRef.current = processor;
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!isSendingAudioRef.current) return;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
        }
        const base64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }));
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);

      // Step 4: Connect via server-side WebSocket proxy
      const wsUrl = new URL("/api/realtime", baseUrl);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      wsUrl.searchParams.set("token", client_secret);

      const ws = new WebSocket(wsUrl.toString());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");

        // Minimal session config — just set audio formats
        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
          },
        }));

        // Initiate story
        const storyTranslation = getStoryTranslation(t, story.id);
        const languageInstruction = t.voiceAgent.languageInstruction;
        const initiationMessage = t.voiceAgent.initiationMessage
          .replace(/{storyTitle}/g, storyTranslation.title)
          .replace(/{languageInstruction}/g, languageInstruction);

        ws.send(JSON.stringify({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text: initiationMessage }] },
        }));
        ws.send(JSON.stringify({ type: "response.create" }));

        transcriptRef.current = [];
        currentAITextRef.current = "";
        userTurnCountRef.current = 0;
        addSession(story.id);
        setStatus("listening");
        setIsSessionActive(true);
        startPulseAnimation();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "response.audio.delta") {
            playAudioChunk(data.delta);
            setStatus("speaking");
            isSendingAudioRef.current = false;
            setIsMuted(true);
            stopPulseAnimation();
          } else if (data.type === "response.audio_transcript.delta") {
            currentAITextRef.current += data.delta || "";
            setStatus("speaking");
            isSendingAudioRef.current = false;
            setIsMuted(true);
            stopPulseAnimation();
          } else if (data.type === "response.done") {
            if (currentAITextRef.current.trim()) {
              transcriptRef.current.push({ role: "ai", text: currentAITextRef.current.trim(), timestamp: Date.now() });
              currentAITextRef.current = "";
            }
            setStatus("listening");
            setIsMuted(true);
            startPulseAnimation();
          } else if (data.type === "conversation.item.input_audio_transcription.completed") {
            const transcript = data.transcript?.trim();
            if (transcript) {
              transcriptRef.current.push({ role: "user", text: transcript, timestamp: Date.now() });
              userTurnCountRef.current += 1;
              if (userTurnCountRef.current >= 8) markStoryCompleted(story.id);
            }
          } else if (data.type === "error") {
            console.error("OpenAI WS error:", JSON.stringify(data.error));
          }
        } catch (e) {
          // Non-JSON, ignore
        }
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        setIsSessionActive(false);
        setStatus("error");
        stopPulseAnimation();
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        setStatus("error");
      };

    } catch (error) {
      console.error("Connection error:", error);
      setStatus("error");
      Alert.alert("Connection Error", "Could not connect to StoryLingo. Please try again.");
    }
  }, [story, language, t, startPulseAnimation, stopPulseAnimation, playAudioChunk, addSession, markStoryCompleted]);

  const connectToRealtimeNative = useCallback(async () => {
    // For native mobile, show a message that this feature works best on web
    // In a production app, you would implement react-native-webrtc or use a WebSocket fallback
    Alert.alert(
      "Voice Chat",
      "For the best voice experience, please use StoryLingo in a web browser. Scan the QR code and choose 'Open in browser' instead of Expo Go.",
      [{ text: "OK", onPress: () => setStatus("idle") }]
    );
    setStatus("idle");
  }, []);

  const sendMessageToAI = (message: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: message }] },
      }));
      ws.send(JSON.stringify({ type: "response.create" }));
    }
  };

  const handleTalkPress = () => {
    // Only used to START the session (idle / error state)
    if (status === "idle" || status === "error") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (Platform.OS === "web") {
        connectToRealtimeWeb();
      } else {
        connectToRealtimeNative();
      }
    }
    // All active-session mic control is handled by pressIn/pressOut (push-to-talk)
  };

  const handleTalkPressIn = () => {
    talkButtonScale.value = withSpring(0.95, { damping: 15 });
    if (isSessionActive && status !== "speaking" && !isPaused) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      isSendingAudioRef.current = true;
      setIsMuted(false);
      setIsHolding(true);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            turn_detection: {
              type: "server_vad",
              threshold: 0.85,
              prefix_padding_ms: 300,
              silence_duration_ms: 1000,
            },
          },
        }));
      }
    }
  };

  const handleTalkPressOut = () => {
    talkButtonScale.value = withSpring(1, { damping: 15 });
    if (isSessionActive && isHolding) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      isSendingAudioRef.current = false;
      setIsMuted(true);
      setIsHolding(false);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        ws.send(JSON.stringify({ type: "session.update", session: { turn_detection: null } }));
      }
    }
  };

  const handlePause = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isSessionActive) {
      if (isPaused) {
        sendMessageToAI(t.voiceAgent.resumeMessage);
        setIsPaused(false);
        startPulseAnimation();
      } else {
        sendMessageToAI(t.voiceAgent.pauseMessage);
        setIsPaused(true);
        stopPulseAnimation();
      }
    }
  };

  const stopSession = () => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (scriptProcessorRef.current) { scriptProcessorRef.current.disconnect(); scriptProcessorRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    isSendingAudioRef.current = false;
    setIsSessionActive(false);
    setStatus("idle");
    setIsMuted(false);
    setIsPaused(false);
    stopPulseAnimation();
  };

  const handleBack = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (transcriptRef.current.length > 0) {
      await saveTranscript(story.id, transcriptRef.current);
    }
    const transcript = [...transcriptRef.current];
    stopSession();
    if (transcript.length > 0) {
      navigation.replace("ConversationReview", { story, transcript });
    } else {
      navigation.replace("StorySelection");
    }
  };

  const formatTimeRemaining = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusText = () => {
    if (isPaused && isSessionActive) {
      return t.session.paused;
    }
    switch (status) {
      case "connecting":
        return t.session.connecting;
      case "speaking":
        return t.session.speaking;
      case "listening":
        return isHolding ? t.session.listening : t.session.holdToSpeak;
      case "error":
        return t.session.connectionLost;
      case "idle":
        return "Tap to begin";
      default:
        return t.session.connecting;
    }
  };

  const getTalkButtonColor = () => {
    if (isPaused && isSessionActive) return ["#888888", "#AAAAAA"];
    if (status === "idle" || status === "error") return [StoryBuddyColors.primary, "#FF8FB3"];
    if (status === "speaking") return [StoryBuddyColors.secondary, "#FFE066"]; // Gold: AI talking
    if (isHolding) return ["#FF3366", "#FF6B9D"];  // Bright red-pink: actively recording
    if (status === "listening") return ["#B0A0C0", "#C0B0D0"]; // Grey: waiting, hold to speak
    if (status === "connecting") return ["#B0A0C0", "#C0B0D0"];
    return ["#B0A0C0", "#C0B0D0"];
  };

  const getTalkButtonIcon = () => {
    if (status === "idle" || status === "error") return "play";
    if (isPaused && isSessionActive) return "play";
    if (status === "speaking") return "volume-2"; // AI talking — gold button
    if (isHolding) return "mic";                  // Child actively speaking — bright pink
    return "mic-off";                             // Waiting — grey, hold to speak
  };

  const portalText = (t as any).portal?.[story.id] || t.session.connecting;

  const isConnectingOrIdle = status === "idle" || status === "connecting" || status === "error";

  return (
    <View
      style={styles.container}
      // @ts-ignore: web-only prop to block long-press context menu on mobile Safari
      onContextMenu={(e: any) => e.preventDefault()}
    >
      <ImageBackground
        source={story.image}
        style={styles.backgroundImage}
        resizeMode="cover"
      >
        <LinearGradient
          colors={
            isConnectingOrIdle
              ? ["rgba(45, 27, 78, 0.75)", "rgba(45, 27, 78, 0.92)"]
              : ["rgba(45, 27, 78, 0.55)", "rgba(45, 27, 78, 0.85)"]
          }
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.overlay}
        >
          <View
            style={[
              styles.content,
              {
                paddingTop: headerHeight + Spacing["3xl"],
                paddingBottom: insets.bottom + Spacing["3xl"],
              },
            ]}
          >
            {isConnectingOrIdle ? (
              /* ---- PORTAL / CONNECTING STATE ---- */
              <>
                <View style={styles.portalTopSpacer} />

                <View style={styles.portalCenter}>
                  <View style={styles.portalImageRing}>
                    <View style={styles.portalImageInner}>
                      <Image
                        source={story.image}
                        style={styles.portalCharacterImage}
                        resizeMode="cover"
                      />
                    </View>
                  </View>

                  <ThemedText style={styles.portalText}>
                    {status === "connecting" ? portalText : story.title}
                  </ThemedText>

                  {status === "error" && (
                    <ThemedText style={styles.portalSubtext}>
                      {t.session.connectionLost}
                    </ThemedText>
                  )}
                </View>

                <View style={styles.portalBottom}>
                  {status === "idle" || status === "error" ? (
                    <Pressable
                      onPress={handleTalkPress}
                      onPressIn={handleTalkPressIn}
                      onPressOut={handleTalkPressOut}
                      style={styles.portalStartButton}
                      testID="button-talk"
                    >
                      <LinearGradient
                        colors={[StoryBuddyColors.primary, "#FF8FB3"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.portalStartGradient}
                      >
                        <Feather name="play" size={32} color="#FFFFFF" />
                        <Text style={styles.portalStartText}>
                          {status === "error" ? "Retry" : "Start Story"}
                        </Text>
                      </LinearGradient>
                    </Pressable>
                  ) : (
                    <View style={styles.connectingDots}>
                      <Animated.View style={[styles.dot, { opacity: glowOpacity }]} />
                      <Animated.View style={[styles.dot, styles.dotDelay]} />
                      <Animated.View style={[styles.dot, styles.dotDelay2]} />
                    </View>
                  )}

                  <Pressable
                    style={styles.portalBackButton}
                    onPress={handleBack}
                    testID="button-back"
                  >
                    <Feather name="arrow-left" size={18} color="rgba(255,255,255,0.7)" />
                    <Text style={styles.portalBackText}>{t.session.back}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              /* ---- ACTIVE SESSION STATE ---- */
              <>
                <View style={styles.sessionTopRow}>
                  <View style={styles.sessionCharacterBadge}>
                    <Image
                      source={story.image}
                      style={styles.sessionCharacterThumb}
                      resizeMode="cover"
                    />
                    <ThemedText style={styles.sessionStoryTitle}>{story.title}</ThemedText>
                  </View>

                  {isFreeTrial ? (
                    <View style={[styles.countdownBadge, isLowTime ? styles.countdownBadgeWarning : null]}>
                      <Feather
                        name="clock"
                        size={14}
                        color={isLowTime ? StoryBuddyColors.error : "rgba(255,255,255,0.7)"}
                      />
                      <Text style={[styles.countdownText, isLowTime ? styles.countdownTextWarning : null]}>
                        {t.session.timeLeft.replace("{time}", formatTimeRemaining(displayRemainingSeconds))}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <ThemedText style={styles.statusText}>{getStatusText()}</ThemedText>

                <View style={styles.talkButtonContainer}>
                  <Pressable
                    onPress={handleTalkPress}
                    onPressIn={handleTalkPressIn}
                    onPressOut={handleTalkPressOut}
                    style={styles.talkButtonOuter}
                    testID="button-talk"
                  >
                    <View style={styles.talkButtonWrapper}>
                      <Animated.View style={[styles.pulseRing, pulseStyle]} />
                      <Animated.View style={[styles.talkButton, talkButtonStyle]}>
                        <LinearGradient
                          colors={getTalkButtonColor() as [string, string]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.talkButtonGradient}
                        >
                          <Feather
                            name={getTalkButtonIcon() as any}
                            size={64}
                            color="#FFFFFF"
                          />
                        </LinearGradient>
                      </Animated.View>
                    </View>
                    {status === "listening" && !isPaused && (
                      <View style={styles.holdHintContainer}>
                        <Feather
                          name={isHolding ? "radio" : "mic"}
                          size={14}
                          color={isHolding ? "#FF3366" : "rgba(255,255,255,0.7)"}
                        />
                        <ThemedText
                          selectable={false}
                          style={[
                            styles.holdHintText,
                            isHolding && styles.holdHintTextActive,
                          ]}
                        >
                          {isHolding ? t.session.listening : t.session.holdToSpeak}
                        </ThemedText>
                      </View>
                    )}
                  </Pressable>
                </View>

                <View style={styles.controlsContainer}>
                  <Pressable
                    style={styles.controlButton}
                    onPress={handleBack}
                    testID="button-back"
                  >
                    <Feather name="arrow-left" size={20} color="rgba(255,255,255,0.7)" />
                    <ThemedText style={styles.controlButtonText}>{t.session.back}</ThemedText>
                  </Pressable>

                  <Pressable
                    style={[styles.controlButton, isPaused ? styles.pauseButtonActive : null]}
                    onPress={handlePause}
                    testID="button-pause"
                    disabled={!isSessionActive}
                  >
                    <Feather
                      name={isPaused ? "play" : "pause"}
                      size={20}
                      color={isPaused ? StoryBuddyColors.primary : "rgba(255,255,255,0.7)"}
                    />
                    <ThemedText
                      style={[styles.controlButtonText, isPaused ? { color: StoryBuddyColors.primary } : null]}
                    >
                      {isPaused ? t.session.resume : t.session.pause}
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </LinearGradient>
      </ImageBackground>
    </View>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  content: {
    backgroundColor: "#FFFFFF",
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255, 107, 157, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  title: {
    ...Typography.h3,
    color: StoryBuddyColors.textPrimary,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    color: StoryBuddyColors.textSecondary,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  features: {
    alignSelf: "stretch",
    marginBottom: Spacing.xl,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  featureText: {
    ...Typography.body,
    color: StoryBuddyColors.textPrimary,
  },
  button: {
    backgroundColor: StoryBuddyColors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing["3xl"],
    borderRadius: BorderRadius.xl,
    width: "100%",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
  dismissButton: {
    padding: Spacing.sm,
  },
  dismissText: {
    ...Typography.body,
    color: StoryBuddyColors.textSecondary,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#2D1B4E",
  },
  backgroundImage: {
    flex: 1,
    width: "100%",
    height: "100%",
    // @ts-ignore: web-only properties to prevent long-press context menu on mobile browsers
    WebkitTouchCallout: "none",
    WebkitUserSelect: "none",
    userSelect: "none",
  },
  overlay: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing["2xl"],
  },

  // ---- PORTAL / CONNECTING STATE ----
  portalTopSpacer: {
    height: 40,
  },
  portalCenter: {
    alignItems: "center",
    gap: Spacing.xl,
  },
  portalImageRing: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 4,
    borderColor: "rgba(255, 107, 157, 0.6)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 107, 157, 0.15)",
  },
  portalImageInner: {
    width: 180,
    height: 180,
    borderRadius: 90,
    overflow: "hidden",
  },
  portalCharacterImage: {
    width: "100%",
    height: "100%",
  },
  portalText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.3)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  portalSubtext: {
    fontSize: 14,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
  },
  portalBottom: {
    alignItems: "center",
    gap: Spacing.xl,
  },
  portalStartButton: {
    borderRadius: BorderRadius["2xl"],
    overflow: "hidden",
    shadowColor: StoryBuddyColors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  portalStartGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["3xl"],
  },
  portalStartText: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  connectingDots: {
    flexDirection: "row",
    gap: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: StoryBuddyColors.primary,
  },
  dotDelay: {
    opacity: 0.6,
  },
  dotDelay2: {
    opacity: 0.3,
  },
  portalBackButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  portalBackText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.7)",
  },

  // ---- ACTIVE SESSION STATE ----
  sessionTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  sessionCharacterBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingRight: Spacing.lg,
    borderRadius: BorderRadius.full,
  },
  sessionCharacterThumb: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  sessionStoryTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  statusText: {
    fontSize: 16,
    color: "rgba(255,255,255,0.8)",
    textAlign: "center",
  },
  countdownBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    paddingVertical: 8,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  countdownBadgeWarning: {
    backgroundColor: "rgba(255, 107, 107, 0.25)",
    borderColor: "rgba(255, 107, 107, 0.5)",
  },
  countdownText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
  },
  countdownTextWarning: {
    color: StoryBuddyColors.error,
  },
  talkButtonContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  talkButtonOuter: {
    alignItems: "center",
  },
  talkButtonWrapper: {
    width: 220,
    height: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  holdHintContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  holdHintText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
    fontWeight: "500",
  },
  holdHintTextActive: {
    color: "#FF3366",
    fontWeight: "600",
  },
  pulseRing: {
    position: "absolute",
    top: 10,
    left: 10,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: StoryBuddyColors.primary,
  },
  talkButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    overflow: "hidden",
    shadowColor: StoryBuddyColors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  talkButtonGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  controlsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.lg,
  },
  controlButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  pauseButtonActive: {
    borderColor: StoryBuddyColors.primary,
    backgroundColor: "rgba(255, 107, 157, 0.2)",
  },
  controlButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.7)",
  },
});
