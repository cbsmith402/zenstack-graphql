import { Playground } from '@/components/playground';
import { getDemoSnapshot } from '@/lib/zenstack-demo';
import { DEFAULT_DEMO_ROLE, getGraphqlSchemaSDL } from '@/lib/graphql-schema';
import { sampleOperations, zmodelSource } from '@/lib/schema-definition';

export default async function HomePage() {
    return (
        <Playground
            samples={sampleOperations}
            initialRole={DEFAULT_DEMO_ROLE}
            initialSchema={await getGraphqlSchemaSDL(DEFAULT_DEMO_ROLE)}
            initialSnapshot={await getDemoSnapshot()}
            initialZModel={zmodelSource}
        />
    );
}
