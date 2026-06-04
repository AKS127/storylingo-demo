import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Linking,
  Platform,
  TextInput,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSubscription } from '@/context/SubscriptionContext';
import { StoryBuddyColors, Spacing, BorderRadius, Typography } from '@/constants/theme';
import type { RootStackParamList } from '@/navigation/RootStackNavigator';

const DEV_PASSWORD = '1234';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { 
    status, 
    trialDaysRemaining, 
    hasActiveSubscription, 
    restorePurchases,
    dailyListenTimeSeconds,
    dailyLimitSeconds,
    resetForTesting,
    simulateExpiredTrial,
  } = useSubscription();
  
  const [showDevMode, setShowDevMode] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  
  // Daily limit only applies to free trial (before signing up for any plan)
  const isFreeTrial = status === 'free_trial';
  const remainingMinutes = Math.ceil(Math.max(0, dailyLimitSeconds - dailyListenTimeSeconds) / 60);

  const handleVersionTap = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (showDevMode) {
      setShowDevMode(false);
    } else {
      setShowPasswordModal(true);
    }
  };

  const handlePasswordSubmit = () => {
    if (passwordInput === DEV_PASSWORD) {
      setShowDevMode(true);
      setShowPasswordModal(false);
      setPasswordInput('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Incorrect Password', 'Please try again.');
      setPasswordInput('');
    }
  };

  const getSubscriptionStatusText = () => {
    switch (status) {
      case 'free_trial':
        return `Free Trial (${trialDaysRemaining} days left)`;
      case 'extended_trial':
        return `Extended Trial (${trialDaysRemaining} days left)`;
      case 'monthly':
        return 'Monthly Subscription';
      case 'annual':
        return 'Annual Subscription';
      default:
        return 'Free Plan';
    }
  };

  const getStatusColor = () => {
    if (hasActiveSubscription) {
      return StoryBuddyColors.success;
    }
    return StoryBuddyColors.textSecondary;
  };

  const handleUpgrade = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate('Paywall', { fromTrialPrompt: false });
  };

  const handleManageSubscription = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    if (Platform.OS === 'ios') {
      try {
        await Linking.openURL('https://apps.apple.com/account/subscriptions');
      } catch (error) {
        Alert.alert(
          'Manage Subscription',
          'Go to Settings > Apple ID > Subscriptions to manage your subscription.',
          [{ text: 'OK' }]
        );
      }
    } else {
      try {
        await Linking.openURL('https://play.google.com/store/account/subscriptions');
      } catch (error) {
        Alert.alert(
          'Manage Subscription',
          'Go to Google Play Store > Menu > Subscriptions to manage your subscription.',
          [{ text: 'OK' }]
        );
      }
    }
  };

  const handleRestorePurchases = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const restored = await restorePurchases();
    
    if (restored) {
      Alert.alert('Success', 'Your purchases have been restored.');
    } else {
      Alert.alert('No Purchases Found', 'We couldn\'t find any previous purchases to restore.');
    }
  };

  return (
    <LinearGradient
      colors={['#E8DEFF', '#F8F5FF', '#FFE8F0']}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.subscriptionCard}>
          <View style={styles.subscriptionHeader}>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor() }]}>
              <Text style={styles.statusBadgeText}>
                {hasActiveSubscription ? 'ACTIVE' : 'INACTIVE'}
              </Text>
            </View>
          </View>
          
          <View style={styles.subscriptionInfo}>
            <Text style={styles.subscriptionLabel}>Current Plan</Text>
            <Text style={styles.subscriptionStatus}>{getSubscriptionStatusText()}</Text>
          </View>

          {isFreeTrial ? (
            <View style={styles.dailyLimitInfo}>
              <Feather name="clock" size={16} color={StoryBuddyColors.textSecondary} />
              <Text style={styles.dailyLimitText}>
                {remainingMinutes} min remaining today (15 min daily limit)
              </Text>
            </View>
          ) : null}

          {!hasActiveSubscription ? (
            <Pressable style={styles.upgradeButton} onPress={handleUpgrade}>
              <Feather name="star" size={18} color="#FFFFFF" />
              <Text style={styles.upgradeButtonText}>Upgrade to Premium</Text>
            </Pressable>
          ) : null}

          {hasActiveSubscription ? (
            <Pressable style={styles.manageButton} onPress={handleManageSubscription}>
              <Feather name="external-link" size={18} color={StoryBuddyColors.primary} />
              <Text style={styles.manageButtonText}>Manage Subscription</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          
          <Pressable style={styles.menuItem} onPress={handleRestorePurchases}>
            <View style={styles.menuItemLeft}>
              <View style={styles.menuIconContainer}>
                <Feather name="refresh-cw" size={20} color={StoryBuddyColors.primary} />
              </View>
              <Text style={styles.menuItemText}>Restore Purchases</Text>
            </View>
            <Feather name="chevron-right" size={20} color={StoryBuddyColors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Legal</Text>
          
          <Pressable style={styles.menuItem}>
            <View style={styles.menuItemLeft}>
              <View style={styles.menuIconContainer}>
                <Feather name="file-text" size={20} color={StoryBuddyColors.primary} />
              </View>
              <Text style={styles.menuItemText}>Terms of Service</Text>
            </View>
            <Feather name="chevron-right" size={20} color={StoryBuddyColors.textSecondary} />
          </Pressable>

          <Pressable style={styles.menuItem}>
            <View style={styles.menuItemLeft}>
              <View style={styles.menuIconContainer}>
                <Feather name="shield" size={20} color={StoryBuddyColors.primary} />
              </View>
              <Text style={styles.menuItemText}>Privacy Policy</Text>
            </View>
            <Feather name="chevron-right" size={20} color={StoryBuddyColors.textSecondary} />
          </Pressable>
        </View>

        {showDevMode ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Developer Tools</Text>
            
            <Pressable 
              style={styles.menuItem} 
              onPress={async () => {
                await simulateExpiredTrial();
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert('Testing', 'Trial has been expired. Go back and tap a story to see the paywall.');
              }}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconContainer, { backgroundColor: 'rgba(255, 107, 107, 0.1)' }]}>
                  <Feather name="x-circle" size={20} color={StoryBuddyColors.error} />
                </View>
                <Text style={styles.menuItemText}>Simulate Expired Trial</Text>
              </View>
              <Feather name="chevron-right" size={20} color={StoryBuddyColors.textSecondary} />
            </Pressable>

            <Pressable 
              style={styles.menuItem}
              onPress={async () => {
                await resetForTesting();
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert('Testing', 'Subscription reset to new 3-day free trial.');
              }}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconContainer, { backgroundColor: 'rgba(78, 205, 196, 0.1)' }]}>
                  <Feather name="rotate-ccw" size={20} color={StoryBuddyColors.success} />
                </View>
                <Text style={styles.menuItemText}>Reset to New User (3-day trial)</Text>
              </View>
              <Feather name="chevron-right" size={20} color={StoryBuddyColors.textSecondary} />
            </Pressable>
          </View>
        ) : null}

        <Pressable onPress={handleVersionTap}>
          <Text style={styles.versionText}>StoryLingo v1.0.0</Text>
        </Pressable>

        <Modal
          visible={showPasswordModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPasswordModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Enter Developer Password</Text>
              <TextInput
                style={styles.passwordInput}
                value={passwordInput}
                onChangeText={setPasswordInput}
                placeholder="Password"
                secureTextEntry
                keyboardType="number-pad"
                autoFocus
              />
              <View style={styles.modalButtons}>
                <Pressable 
                  style={styles.modalCancelButton}
                  onPress={() => {
                    setShowPasswordModal(false);
                    setPasswordInput('');
                  }}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable 
                  style={styles.modalSubmitButton}
                  onPress={handlePasswordSubmit}
                >
                  <Text style={styles.modalSubmitText}>Enter</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
  },
  subscriptionCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  subscriptionHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: Spacing.md,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  statusBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  subscriptionInfo: {
    marginBottom: Spacing.md,
  },
  dailyLimitInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(255, 107, 157, 0.1)',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.lg,
  },
  dailyLimitText: {
    fontSize: 13,
    color: StoryBuddyColors.textSecondary,
    flex: 1,
  },
  subscriptionLabel: {
    ...Typography.small,
    color: StoryBuddyColors.textSecondary,
    marginBottom: Spacing.xs,
  },
  subscriptionStatus: {
    ...Typography.h4,
    color: StoryBuddyColors.textPrimary,
  },
  upgradeButton: {
    backgroundColor: StoryBuddyColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  upgradeButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  manageButton: {
    backgroundColor: 'rgba(255, 107, 157, 0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  manageButtonText: {
    color: StoryBuddyColors.primary,
    fontWeight: '600',
    fontSize: 16,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    ...Typography.small,
    color: StoryBuddyColors.textSecondary,
    fontWeight: '600',
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  menuItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 107, 157, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  menuItemText: {
    ...Typography.body,
    color: StoryBuddyColors.textPrimary,
  },
  versionText: {
    ...Typography.small,
    color: StoryBuddyColors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    width: '80%',
    maxWidth: 300,
  },
  modalTitle: {
    ...Typography.h4,
    color: StoryBuddyColors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    alignItems: 'center',
  },
  modalCancelText: {
    color: StoryBuddyColors.textSecondary,
    fontWeight: '600',
  },
  modalSubmitButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: StoryBuddyColors.primary,
    alignItems: 'center',
  },
  modalSubmitText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
