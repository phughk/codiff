import claudeIconUrl from '../../assets/claude.svg';
import codexIconUrl from '../../assets/codex.svg';
import opencodeIconUrl from '../../assets/opencode.svg';
import piIconUrl from '../../assets/pi.svg';

export const agentIconUrl = (agentId: 'codex' | 'claude' | 'opencode' | 'pi') => {
  return agentId === 'pi'
    ? piIconUrl
    : agentId === 'opencode'
      ? opencodeIconUrl
      : agentId === 'claude'
        ? claudeIconUrl
        : codexIconUrl;
};
