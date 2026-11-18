import {
  Activity,
  Film,
  FolderKanban,
  Home,
  Image as ImageIcon,
  Layers,
  Menu,
  Mic,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Wand2,
  X,
} from 'lucide-react';
import { t } from '../i18n/translations';
import type { Language, UserProfile } from '../types/studio';

export type StudioRoute =
  | 'home'
  | 'generator'
  | 'editor'
  | 'tools'
  | 'audio'
  | 'image'
  | 'templates'
  | 'projects'
  | 'queue'
  | 'admin'
  | 'settings';

interface SidebarNavProps {
  active: StudioRoute;
  onSelect: (route: StudioRoute) => void;
  language: Language;
  onToggleLanguage: (lang: Language) => void;
  user: UserProfile | null;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  onOpenAuth: () => void;
}

const NAV_ITEMS: Array<{ id: StudioRoute; key: string; icon: typeof Home }> = [
  { id: 'home', key: 'navHome', icon: Home },
  { id: 'generator', key: 'navGenerator', icon: Film },
  { id: 'editor', key: 'navEditor', icon: SlidersHorizontal },
  { id: 'tools', key: 'navTools', icon: Wand2 },
  { id: 'audio', key: 'navAudio', icon: Mic },
  { id: 'image', key: 'navImage', icon: ImageIcon },
  { id: 'templates', key: 'navTemplates', icon: Layers },
  { id: 'projects', key: 'navProjects', icon: FolderKanban },
  { id: 'queue', key: 'navQueue', icon: Activity },
  { id: 'admin', key: 'navAdmin', icon: ShieldCheck },
  { id: 'settings', key: 'navSettings', icon: Settings },
];

export function SidebarNav({
  active,
  onSelect,
  language,
  onToggleLanguage,
  user,
  mobileOpen,
  setMobileOpen,
  onOpenAuth,
}: SidebarNavProps) {
  const navBody = (
    <div className="flex h-full flex-col bg-[#0D0F16] border-r border-white/8 select-none">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
        <button
          onClick={() => {
            onSelect('home');
            setMobileOpen(false);
          }}
          className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0 text-left"
        >
          {t(language, 'brand')}
        </button>
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-md"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                onSelect(item.id);
                setMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{t(language, item.key)}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/8 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">{t(language, 'languageLabel')}</span>
          <div className="flex items-center gap-1 p-0.5 bg-[#161924] rounded-md border border-white/8">
            <button
              onClick={() => onToggleLanguage('en')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                language === 'en' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              EN
            </button>
            <button
              onClick={() => onToggleLanguage('hi')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                language === 'hi' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              हिन्दी
            </button>
          </div>
        </div>

        <button
          onClick={onOpenAuth}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#141722] hover:bg-[#1B1F2E] border border-white/8 text-left transition-colors"
        >
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-200 truncate">
              {user?.name || 'Studio Account'}
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {user?.role === 'admin' ? 'Admin · Free Editing Mode' : 'Creator · Free Editing'}
            </div>
          </div>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-60 shrink-0 h-screen sticky top-0">{navBody}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 h-full">{navBody}</div>
          <div
            className="flex-1 bg-black/60 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}
    </>
  );
}

export function MobileTopToggle({
  onOpen,
  title,
  onPrimaryAction,
  primaryLabel,
}: {
  onOpen: () => void;
  title: string;
  onPrimaryAction: () => void;
  primaryLabel: string;
}) {
  return (
    <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-4 px-4 py-3 bg-[#0D0F16]/95 backdrop-blur-md border-b border-white/8">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onOpen}
          className="p-2 -ml-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/5"
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="font-display text-sm font-semibold text-white truncate">{title}</span>
      </div>
      <button
        onClick={onPrimaryAction}
        className="px-3.5 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white whitespace-nowrap shrink-0"
      >
        {primaryLabel}
      </button>
    </header>
  );
}
