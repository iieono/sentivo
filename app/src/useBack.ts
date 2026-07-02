import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

// Run `handler` on the Android hardware back button while this screen is focused.
// Return true to consume the press (unwind internal state); false to let navigation pop.
export function useBackHandler(handler: () => boolean) {
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', handler);
      return () => sub.remove();
    }, [handler])
  );
}
