// client/src/context/SubscriptionContext.tsx
import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
} from "react";
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import api from "../services/api";
import type {
  SubscriptionPlan,
  SubscriptionStatus,
  QuestionLimits,
} from "../services/api";

interface SubscriptionState {
  currentSubscription: SubscriptionStatus | null;
  availablePlans: SubscriptionPlan[];
  questionLimits: QuestionLimits | null;
  isLoading: boolean;
  error: string | null;
  isProcessingPayment: boolean;
  isInitialized: boolean; // Add this to prevent loops
}

interface SubscriptionContextType extends SubscriptionState {
  loadSubscriptionData: () => Promise<void>;
  loadQuestionLimits: () => Promise<void>;
  createSubscription: (
    priceId: string
  ) => Promise<{ client_secret: string; subscription_id: string }>;
  cancelSubscription: () => Promise<void>;
  resumeSubscription: () => Promise<void>;
  clearError: () => void;
  getMaxQuestions: () => number;
  getMinQuestions: () => number;
  canSelectQuestions: (count: number) => boolean;
  hasFeature: (feature: string) => boolean;
  isFeatureLimited: () => boolean;

  // Additional helper methods
  getPlanByTier: (tier: string) => SubscriptionPlan | undefined;
  getCurrentPlan: () => SubscriptionPlan | undefined;
  getUpgradePlans: () => SubscriptionPlan[];
  getSubscriptionStatusText: () => string;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(
  undefined
);

interface SubscriptionProviderProps {
  children: ReactNode;
}

export const SubscriptionProvider: React.FC<SubscriptionProviderProps> = ({
  children,
}) => {
  const { isAuthenticated, user } = useAuth();
  const [state, setState] = useState<SubscriptionState>({
    currentSubscription: null,
    availablePlans: [],
    questionLimits: null,
    isLoading: false,
    error: null,
    isProcessingPayment: false,
    isInitialized: false,
  });

  const setLoading = useCallback((isLoading: boolean) => {
    setState((prev) => ({ ...prev, isLoading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const setProcessingPayment = useCallback((isProcessingPayment: boolean) => {
    setState((prev) => ({ ...prev, isProcessingPayment }));
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, [setError]);

  const loadSubscriptionData = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) return;

    try {
      setLoading(true);
      setError(null);

      const [plansResponse, statusResponse] = await Promise.all([
        api.getSubscriptionPlans(),
        api.getSubscriptionStatus(),
      ]);

      setState((prev) => ({
        ...prev,
        availablePlans: plansResponse.plans,
        currentSubscription: statusResponse,
        isInitialized: true,
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to load subscription data";
      setError(errorMessage);
      console.error("Subscription data loading failed:", error);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, setLoading, setError]);

  const loadQuestionLimits = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) return;

    try {
      const limits = await api.getQuestionLimits();
      setState((prev) => ({
        ...prev,
        questionLimits: limits,
      }));
    } catch (error) {
      console.error("Failed to load question limits:", error);
      // Don't set error for this as it's not critical
    }
  }, [isAuthenticated]);

  // Load subscription data when user is authenticated - ONLY ONCE
  useEffect(() => {
    if (isAuthenticated && user && !state.isInitialized) {
      console.log("🔄 Loading subscription data for first time");
      loadSubscriptionData();
      loadQuestionLimits();
    } else if (!isAuthenticated) {
      // Reset subscription data when user logs out
      setState({
        currentSubscription: null,
        availablePlans: [],
        questionLimits: null,
        isLoading: false,
        error: null,
        isProcessingPayment: false,
        isInitialized: false,
      });
    }
  }, [
    isAuthenticated,
    user,
    state.isInitialized,
    loadSubscriptionData,
    loadQuestionLimits,
  ]);

  const createSubscription = useCallback(
    async (
      priceId: string
    ): Promise<{ client_secret: string; subscription_id: string }> => {
      try {
        setProcessingPayment(true);
        setError(null);

        const result = await api.createSubscription(priceId);

        // After successful payment setup, reload subscription data
        await loadSubscriptionData();
        await loadQuestionLimits();

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to create subscription";
        setError(errorMessage);
        throw error;
      } finally {
        setProcessingPayment(false);
      }
    },
    [setProcessingPayment, setError, loadSubscriptionData, loadQuestionLimits]
  );

  const cancelSubscription = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      await api.cancelSubscription();

      // Reload subscription data to reflect the cancellation
      await loadSubscriptionData();
      await loadQuestionLimits();
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to cancel subscription";
      setError(errorMessage);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError, loadSubscriptionData, loadQuestionLimits]);

  const resumeSubscription = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      await api.resumeSubscription();

      // Reload subscription data to reflect the resumption
      await loadSubscriptionData();
      await loadQuestionLimits();
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to resume subscription";
      setError(errorMessage);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError, loadSubscriptionData, loadQuestionLimits]);

  // Helper functions - Updated to use dynamic limits
  const getMaxQuestions = useCallback((): number => {
    if (state.questionLimits) {
      return state.questionLimits.current_limit;
    }

    // Fallback to subscription-based limits
    if (!state.currentSubscription) return 5;

    switch (state.currentSubscription.tier) {
      case "premium-monthly":
      case "premium-annual":
        return 15;
      case "free":
      default:
        return 5;
    }
  }, [state.questionLimits, state.currentSubscription]);

  const getMinQuestions = useCallback((): number => {
    if (state.questionLimits) {
      return state.questionLimits.min_questions;
    }
    return 3; // Default minimum
  }, [state.questionLimits]);

  const canSelectQuestions = useCallback(
    (count: number): boolean => {
      const min = getMinQuestions();
      const max = getMaxQuestions();
      return count >= min && count <= max;
    },
    [getMinQuestions, getMaxQuestions]
  );

  const hasFeature = useCallback(
    (feature: string): boolean => {
      if (!state.currentSubscription) return false;

      const premiumFeatures = [
        "priority-support",
        "advanced-analytics",
        "unlimited-history",
        "enhanced-recommendations",
        "early-access",
      ];

      if (premiumFeatures.includes(feature)) {
        return ["premium-monthly", "premium-annual"].includes(
          state.currentSubscription.tier
        );
      }

      return true; // Basic features available to all
    },
    [state.currentSubscription]
  );

  const isFeatureLimited = useCallback((): boolean => {
    return (
      !state.currentSubscription || state.currentSubscription.tier === "free"
    );
  }, [state.currentSubscription]);

  const getPlanByTier = useCallback(
    (tier: string): SubscriptionPlan | undefined => {
      return state.availablePlans.find((plan) => plan.id === tier);
    },
    [state.availablePlans]
  );

  const getCurrentPlan = useCallback((): SubscriptionPlan | undefined => {
    if (!state.currentSubscription) return undefined;
    return getPlanByTier(state.currentSubscription.tier);
  }, [state.currentSubscription, getPlanByTier]);

  const getUpgradePlans = useCallback((): SubscriptionPlan[] => {
    if (!state.currentSubscription) return state.availablePlans;

    if (state.currentSubscription.tier === "free") {
      return state.availablePlans.filter((plan) => plan.id !== "free");
    }

    if (state.currentSubscription.tier === "premium-monthly") {
      return state.availablePlans.filter(
        (plan) => plan.id === "premium-annual"
      );
    }

    return []; // Already on highest tier
  }, [state.currentSubscription, state.availablePlans]);

  const getSubscriptionStatusText = useCallback((): string => {
    if (!state.currentSubscription) return "No active subscription";

    const { status, cancel_at_period_end, current_period_end } =
      state.currentSubscription;

    if (cancel_at_period_end && current_period_end) {
      const endDate = new Date(current_period_end).toLocaleDateString();
      return `Cancels on ${endDate}`;
    }

    switch (status) {
      case "active":
        return "Active subscription";
      case "past_due":
        return "Payment overdue";
      case "canceled":
        return "Subscription cancelled";
      case "trialing":
        return "Free trial active";
      default:
        return "Subscription status unknown";
    }
  }, [state.currentSubscription]);

  const contextValue: SubscriptionContextType = {
    ...state,
    loadSubscriptionData,
    loadQuestionLimits,
    createSubscription,
    cancelSubscription,
    resumeSubscription,
    clearError,
    getMaxQuestions,
    getMinQuestions,
    canSelectQuestions,
    hasFeature,
    isFeatureLimited,

    // Additional helper methods
    getPlanByTier,
    getCurrentPlan,
    getUpgradePlans,
    getSubscriptionStatusText,
  };

  return (
    <SubscriptionContext.Provider value={contextValue}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export const useSubscription = (): SubscriptionContextType => {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error(
      "useSubscription must be used within a SubscriptionProvider"
    );
  }
  return context;
};

export default SubscriptionContext;
