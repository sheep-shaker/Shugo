import { motion } from 'framer-motion';
import { Construction } from 'lucide-react';
import { Card, CardContent } from '@/components/ui';

interface PlaceholderPageProps {
  title: string;
}

/**
 * Placeholder page for routes under construction
 */
export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto"
    >
      <Card variant="elevated" padding="lg">
        <CardContent className="text-center py-12">
          <div className="w-20 h-20 mx-auto mb-6 bg-gold-100 rounded-2xl flex items-center justify-center">
            <Construction className="h-10 w-10 text-gold-600" />
          </div>
          <h1 className="text-2xl font-display font-semibold text-gray-900 mb-2">
            {title}
          </h1>
          <p className="text-gray-500 max-w-md mx-auto">
            Cette page est en cours de développement.
            <br />
            Elle sera bientôt disponible.
          </p>
          <div className="mt-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-gold-50 text-gold-700 rounded-xl text-sm font-medium">
              <span className="w-2 h-2 bg-gold-500 rounded-full animate-pulse" />
              En construction
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default PlaceholderPage;
