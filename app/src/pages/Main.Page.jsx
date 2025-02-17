import React, { useState, useContext } from "react";
import { Header } from "../layout/Header";
import { TrendingProfiles } from "../components/trending-profiles/TrendingProfiles";
import { ContactList } from "../components/contact-list/ContactList";
import { AppsList } from "../components/apps/AppsList";
import { EditKeyModal } from "../components/edit-key-modal/EditKeyModal";
import { SearchModal } from "../components/search-modal/SearchModal";
import { PinAppModal } from "../components/pin-app-modal/PinAppModal";
import { EventAppsModal } from "../components/event-apps-modal/EventAppsModal";
import { TabMenuModal } from "../components/tab-menu-modal/TabMenuModal";
import { ContextMenuModal } from "../components/context-menu-modal/ContextMenuModal";
import { ImportPubkeyModal } from "../components/onboarding/ImportPubkeyModal";
import { TabsModal } from "../components/tabs/TabsModal";
import { PermRequestModal } from "../components/perms/PermRequestModal";
import { WelcomeWidget } from "../components/onboarding/WelcomeWidget";
import { WalletsModal } from "../components/wallets/WalletsModal";
import { IconButton } from "../components/UI/IconButton";
import { Footer } from "../layout/Footer";
import { styled } from "@mui/material";
import { AppContext } from "../store/app-context";
import { stringToBech32 } from "../nostr";
import { useSearchParams } from "react-router-dom";
import { TrendingNotes } from "../components/trending-notes/TrendingNotes";
import { LongNotes } from "../components/long-notes/LongNotes";
import { LiveEvents } from "../components/live-events/LiveEvents";
import { Zaps } from "../components/zaps/Zaps";
import { Communities } from "../components/communities/Communities";

const MainPage = () => {
  const contextData = useContext(AppContext);
  const {
    onOpenBlank,
    onAddKey,
    onImportPubkey,
    contextInput,
    setContextInput,
    clearLastCurrentTab,
    openAddr,
    setOpenAddr,
    updateLastContact,
    currentTab,
    currentWorkspace,
    keys,
    currentPermRequest,
    replyCurrentPermRequest,
  } = contextData || {};

  const [searchParams, setSearchParams] = useSearchParams();
  const [isEditKeyModalVisible, setIsEditKeyModalVisible] = useState(false);
  const [isPinModalVisible, setIsPinModalVisible] = useState(false);
  const [showTabMenu, setShowTabMenu] = useState(false);
  const [showImportPubkey, setShowImportPubkey] = useState(false);
  const [showTabs, setShowTabs] = useState(false);
  const [showWallets, setShowWallets] = useState(false);

  const isSearchModalVisible = Boolean(searchParams.get("search"));

  const toggleSearchModalVisibility = () => {
    if (!isSearchModalVisible) {
      searchParams.set("search", true);
      return setSearchParams(searchParams);
    }
    searchParams.delete("search");
    return setSearchParams(searchParams, { replace: true });
  };  

  const togglePinModalVisibility = () => {
    setIsPinModalVisible((prevState) => !prevState);
  };

  const onOpenedEvent = () => {
    setOpenAddr("");
  };

  const setContactOpenAddr = (addr) => {
    updateLastContact(addr);
    setOpenAddr(addr);
  };

  const onSearch = (str) => {
    clearLastCurrentTab();
    try {
      const url = new URL("/", str);
      if (url) {
        // need async launch to let the search modal close itself
        setTimeout(() => onOpenBlank({ url: str }), 0);
        return true;
      }
    } catch {}

    const b32 = stringToBech32(str);
    if (b32) {
      setOpenAddr(b32);
      return true;
    }

    return false;
  };

  const onImportKey = () => {
    setShowImportPubkey(true);
  };
  
  return (
    <Container>
      <Header
        onSearchClick={toggleSearchModalVisibility}
        onOpenEditKeyModal={() => setIsEditKeyModalVisible(true)}
        onOpenTabMenuModal={() => setShowTabMenu(true)}
        onOpenWalletsModal={() => setShowWallets(true)}
      />
      <main id="main">

	{keys?.length === 0 && (
	  <WelcomeWidget onAdd={onAddKey} onImport={onImportKey} />
	)}
	
        <TrendingNotes onOpenNote={setOpenAddr} />
        <TrendingProfiles onOpenProfile={setOpenAddr} />
        {currentWorkspace?.highlights.length > 0 &&
	 <TrendingNotes onOpenNote={setOpenAddr} highlight />
	}
        {currentWorkspace?.bigZaps.length > 0 && 
	 <Zaps onOpen={setOpenAddr} />
	}
        {currentWorkspace?.longNotes.length > 0 && 
	 <LongNotes onOpenAddr={setOpenAddr} />
	}
        {currentWorkspace?.liveEvents.length > 0 && 
	 <LiveEvents onOpenAddr={setOpenAddr} />
	}
        {currentWorkspace?.communities.length > 0 && 
	 <Communities onOpen={setOpenAddr} />
	}
        {currentWorkspace?.suggestedProfiles.length > 0 && 
	 <TrendingProfiles onOpenProfile={setOpenAddr} suggested />
	}

	<AppsList />

	<EditKeyModal
	  isOpen={isEditKeyModalVisible}
	  onClose={() => setIsEditKeyModalVisible(false)}
	/>

	<SearchModal
	  isOpen={isSearchModalVisible}
	  onSearch={onSearch}
	  onClose={toggleSearchModalVisibility}
	  onOpenEvent={setOpenAddr}
	  onOpenContact={setContactOpenAddr}
	/>

	<PinAppModal
	  isOpen={isPinModalVisible}
	  onClose={togglePinModalVisibility}
	/>

	<EventAppsModal
	  isOpen={openAddr !== ""}
	  onClose={() => setOpenAddr("")}
	  addr={openAddr}
	  onSelect={onOpenedEvent}
	/>

	<TabMenuModal
	  isOpen={showTabMenu}
	  onClose={() => setShowTabMenu(false)}
	  onOpenWith={setOpenAddr}
	  onOpenPinAppModal={togglePinModalVisibility}
	/>

	<ContextMenuModal
	  isOpen={!!contextInput}
	  onClose={() => setContextInput("")}
	  input={contextInput}
	  onOpenWith={(id) => {
            setContextInput("");
            setTimeout(() => setOpenAddr(id), 0);
	  }}
	/>

	<ImportPubkeyModal
	  isOpen={showImportPubkey}
	  onClose={() => setShowImportPubkey(false)}
	  onSelect={onImportPubkey}
	/>

	<TabsModal
	  isOpen={showTabs}
	  onClose={() => setShowTabs(false)}
	/>

	<PermRequestModal
	  isOpen={currentPermRequest != null}
	  onClose={() => replyCurrentPermRequest(false, false)}
	/>

	<WalletsModal
	  isOpen={showWallets}
	  onClose={() => setShowWallets(false)}
	/>
	
	{currentTab && (
	  <TabBackground className="d-flex flex-column justify-content-center align-items-center">
            <div>
              <IconButton
		data={{ title: currentTab.title, img: currentTab.icon }}
		     size="big"
              />
            </div>
            <div className="mt-2">Loading...</div>
	  </TabBackground>
	)}
      </main>

      <Footer onOpenPinModal={togglePinModalVisibility} onTabs={() => setShowTabs(true)} />
    </Container>
  );
};

const Container = styled("div")`
  min-height: 100dvh;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "header"
    "main"
    "footer";

  & > header {
    grid-area: header;
    position: sticky;
    background: #000;
    z-index: 1199;
    top: 0;
  }

  & > main {
    grid-area: main;
    overflow: scroll;
    max-height: 100%;
    padding-bottom: 6rem;
  }

  & > footer {
    grid-area: footer;
    overflow: auto;
    scrollbar-width: thin;
    position: sticky;
    background: #000;
    z-index: 1199;
    bottom: 0;
  }
`;

const TabBackground = styled("div")`
  position: fixed;
  top: 44px;
  left: 0;
  right: 0;
  bottom: 44px;
  background-color: #000;
  z-index: 1201;
`;

export default MainPage;
