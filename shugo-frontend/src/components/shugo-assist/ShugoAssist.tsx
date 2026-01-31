import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Send,
  Sparkles,
  Loader2,
  Minimize2,
  Maximize2,
  Bot,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const INITIAL_MESSAGE: Message = {
  id: 'initial',
  role: 'assistant',
  content: "Bonjour! Je suis SHUGO Assist, votre assistant intelligent. Comment puis-je vous aider aujourd'hui? Je peux vous aider avec:\n\n• Questions sur le planning\n• Informations sur les gardes\n• Navigation dans l'application\n• Support technique",
  timestamp: new Date(),
};

const QUICK_ACTIONS = [
  { label: 'Planning du jour', query: 'Quel est le planning du jour?' },
  { label: 'Mes gardes', query: 'Quelles sont mes prochaines gardes?' },
  { label: 'Créer une garde', query: 'Comment créer une nouvelle garde?' },
  { label: 'Support', query: "J'ai besoin d'aide technique" },
];

export function ShugoAssist() {
  const { user } = useAuthStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  const simulateAIResponse = async (userMessage: string): Promise<string> => {
    // Simulate AI processing delay
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));

    const lowerMessage = userMessage.toLowerCase();

    // Simple pattern matching for demo
    if (lowerMessage.includes('planning') || lowerMessage.includes('jour')) {
      return "Voici les informations sur votre planning:\n\n• Vous avez 3 gardes programmées cette semaine\n• Prochaine garde: Demain à 08:00\n• Lieu: Poste de garde principal\n\nVoulez-vous voir plus de détails?";
    }

    if (lowerMessage.includes('garde') && lowerMessage.includes('créer')) {
      return "Pour créer une nouvelle garde:\n\n1. Allez dans 'Planning' dans le menu\n2. Cliquez sur 'Nouvelle garde'\n3. Remplissez les informations requises\n4. Validez la création\n\nJe peux vous guider étape par étape si vous le souhaitez.";
    }

    if (lowerMessage.includes('aide') || lowerMessage.includes('support')) {
      return "Je suis là pour vous aider! Voici les options de support:\n\n• Documentation: /help\n• Contact admin: shugopaca@gmail.com\n• FAQ: Section Aide du menu\n\nQuel est votre problème spécifique?";
    }

    if (lowerMessage.includes('bonjour') || lowerMessage.includes('salut')) {
      return `Bonjour ${user?.first_name || 'cher utilisateur'}! Comment puis-je vous aider aujourd'hui?`;
    }

    if (lowerMessage.includes('merci')) {
      return "Je vous en prie! N'hésitez pas si vous avez d'autres questions.";
    }

    // Default response
    return "Je comprends votre demande. Pour mieux vous aider, pourriez-vous préciser:\n\n• S'agit-il d'une question sur le planning?\n• Avez-vous besoin d'aide pour une action spécifique?\n• Est-ce un problème technique?\n\nJe suis là pour vous assister!";
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await simulateAIResponse(userMessage.content);
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "Désolé, une erreur s'est produite. Veuillez réessayer.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };


  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-gradient-to-br from-gold-500 to-gold-600 rounded-full shadow-lg shadow-gold-500/30 flex items-center justify-center text-white hover:shadow-xl hover:shadow-gold-500/40 transition-shadow"
          >
            <Sparkles className="h-6 w-6" />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[10px] font-bold">
              AI
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={cn(
              'fixed z-50 bg-white rounded-2xl shadow-2xl border border-marble-200 flex flex-col overflow-hidden',
              isMinimized
                ? 'bottom-6 right-6 w-80 h-16'
                : 'bottom-6 right-6 w-96 h-[600px] max-h-[80vh]'
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gold-500 to-gold-600 text-white">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">SHUGO Assist</h3>
                  {!isMinimized && (
                    <p className="text-xs text-white/80">Assistant intelligent</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsMinimized(!isMinimized)}
                  className="p-2 rounded-lg hover:bg-white/20 transition-colors"
                >
                  {isMinimized ? (
                    <Maximize2 className="h-4 w-4" />
                  ) : (
                    <Minimize2 className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-lg hover:bg-white/20 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Chat Content */}
            {!isMinimized && (
              <>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-gold">
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        'flex gap-3',
                        message.role === 'user' ? 'flex-row-reverse' : ''
                      )}
                    >
                      <div
                        className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                          message.role === 'user'
                            ? 'bg-gold-100 text-gold-600'
                            : 'bg-marble-100 text-marble-600'
                        )}
                      >
                        {message.role === 'user' ? (
                          <User className="h-4 w-4" />
                        ) : (
                          <Bot className="h-4 w-4" />
                        )}
                      </div>
                      <div
                        className={cn(
                          'max-w-[80%] rounded-2xl px-4 py-3',
                          message.role === 'user'
                            ? 'bg-gold-500 text-white rounded-br-md'
                            : 'bg-marble-100 text-gray-800 rounded-bl-md'
                        )}
                      >
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        <p
                          className={cn(
                            'text-[10px] mt-1',
                            message.role === 'user' ? 'text-white/70' : 'text-gray-400'
                          )}
                        >
                          {message.timestamp.toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </motion.div>
                  ))}

                  {/* Loading indicator */}
                  {isLoading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex gap-3"
                    >
                      <div className="w-8 h-8 rounded-full bg-marble-100 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-marble-600" />
                      </div>
                      <div className="bg-marble-100 rounded-2xl rounded-bl-md px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-gold-500" />
                          <span className="text-sm text-gray-500">Réflexion en cours...</span>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Quick Actions */}
                {messages.length <= 1 && (
                  <div className="px-4 pb-2">
                    <p className="text-xs text-gray-400 mb-2">Actions rapides:</p>
                    <div className="flex flex-wrap gap-2">
                      {QUICK_ACTIONS.map((action) => (
                        <button
                          key={action.label}
                          onClick={() => {
                            setInput(action.query);
                            setTimeout(() => handleSend(), 100);
                          }}
                          className="px-3 py-1.5 bg-marble-50 hover:bg-marble-100 rounded-full text-xs text-gray-600 transition-colors"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Input */}
                <div className="p-4 border-t border-marble-200">
                  <div className="flex items-center gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Posez votre question..."
                      className="flex-1 px-4 py-2.5 bg-marble-50 rounded-xl border-0 focus:ring-2 focus:ring-gold-500 text-sm placeholder:text-gray-400"
                      disabled={isLoading}
                    />
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() || isLoading}
                      className={cn(
                        'p-2.5 rounded-xl transition-all',
                        input.trim() && !isLoading
                          ? 'bg-gold-500 text-white hover:bg-gold-600'
                          : 'bg-marble-100 text-gray-400 cursor-not-allowed'
                      )}
                    >
                      {isLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 text-center">
                    SHUGO Assist - IA propulsée par votre assistant local
                  </p>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default ShugoAssist;
