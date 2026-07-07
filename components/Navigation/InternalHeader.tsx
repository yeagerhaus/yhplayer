import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Div } from '../Div';
import { HeaderBackButton } from './HeaderBackButton';

export const INTERNAL_HEADER_OFFSET = 44;

export function InternalHeader() {
	const insets = useSafeAreaInsets();
	return (
		<Div
			transparent
			style={{
				position: 'absolute',
				top: 0,
				alignItems: 'center',
				backgroundColor: 'transparent',
				width: '100%',
			}}
		>
			<Div
				transparent
				style={{
					width: '100%',
					height: insets.top + INTERNAL_HEADER_OFFSET,
					display: 'flex',
					justifyContent: 'flex-end',
					backgroundColor: 'transparent',
				}}
			>
				<HeaderBackButton />
			</Div>
		</Div>
	);
}
