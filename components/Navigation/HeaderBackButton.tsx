import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Div } from '../Div';

export function HeaderBackButton() {
	const router = useRouter();
	const colors = useColors();

	const handleBack = () => {
		if (router.canGoBack()) {
			router.back();
		} else {
			// Fallback to home screen if there's no route behind
			router.replace('/(tabs)/home');
		}
	};

	return (
		<Pressable
			onPress={handleBack}
			style={{ marginLeft: 16, height: 50, width: 50, borderRadius: 100, alignItems: 'center', justifyContent: 'center' }}
		>
			<Div useGlass style={{ width: 50, height: 50, borderRadius: 100, alignItems: 'center', justifyContent: 'center' }}>
				<SymbolView name='chevron.left' type='hierarchical' tintColor={colors.brand} />
			</Div>
		</Pressable>
	);
}
