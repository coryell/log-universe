import license from 'rollup-plugin-license';
import { resolve } from 'path';

export default {
    build: {
        rollupOptions: {
            plugins: [
                license({
                    thirdParty: {
                        output: {
                            file: resolve('public', 'THIRD-PARTY-LICENSES.txt'),
                            encoding: 'utf-8',
                        },
                        allow: '(MIT OR ISC OR BSD-2-Clause OR BSD-3-Clause OR Apache-2.0 OR 0BSD)',
                    },
                }),
            ],
        },
    },
};
