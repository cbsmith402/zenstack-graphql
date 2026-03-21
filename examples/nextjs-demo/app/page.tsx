import { Playground } from '@/components/playground';
import { getDemoSnapshot } from '@/lib/zenstack-demo';
import { graphqlSchemaSDL } from '@/lib/graphql-schema';
import { sampleOperations, zmodelSource } from '@/lib/schema-definition';

export default async function HomePage() {
    return (
        <Playground
            samples={sampleOperations}
            initialSchema={graphqlSchemaSDL}
            initialSnapshot={await getDemoSnapshot()}
            initialZModel={zmodelSource}
        />
    );
}
