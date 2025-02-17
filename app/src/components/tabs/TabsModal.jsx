import { useContext } from "react";
import { AppContext } from "../../store/app-context";
import { SecondaryCloseIcon } from "../../assets";
import {
  Container,
  IconButton as MUIconButton,
  styled,
} from "@mui/material";
import { Modal } from "../UI/modal/Modal";

import { IconButton } from "../UI/IconButton";

export const TabsModal = ({ isOpen, onClose }) => {
  const contextData = useContext(AppContext);
  const { currentWorkspace, getTab, onOpenTab, onCloseTabAny, clearLastCurrentTab, currentTab } =
    contextData || {};
  
  const handleOpenTab = (tab) => {
    // to make sure onClose doesn't re-open the calling tab
    clearLastCurrentTab();
    onClose();
    onOpenTab(tab);
  };

  const handleCloseTab = (tab) => {
    // to make sure onClose doesn't re-open the calling tab
    onCloseTabAny(tab);
  };

  const handleCloseTabGroup = (tabs) => {
    // to make sure onClose doesn't re-open the calling tab
    tabs.forEach(tab => onCloseTabAny(tab));
  };

  const tgs = Object.values(currentWorkspace?.tabGroups || {}).filter(
    (tg) => tg.tabs.length > 0
  );
  tgs.sort((a, b) => b.lastActive - a.lastActive);

  const prepareTabs = (tabs) => {
    return tabs
      .map((id) => getTab(id))
      .sort((a, b) => b.lastActive - a.lastActive);
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <StyledContainer>
        <StyledHeader>
          <h1>Tabs</h1>
          <StyledIconButton onClick={onClose}>
            <SecondaryCloseIcon />
          </StyledIconButton>
        </StyledHeader>
        <>
	  {!tgs.length && (<>No active tabs.</>)}
          {tgs.map((tg) => {
            const tabs = prepareTabs(tg.tabs);
            return (
              <TabGroup key={tg.id}>
                <Title>
                  <IconButton
                    data={{ title: "", img: tg.info.icon }}
                    size="small"
                  />
                  <div className="label">{tg.info.title}</div>
                  <StyledIconButton
                    onClick={() => handleCloseTabGroup(tabs)}
                    size="small"
                  >
                    <SecondaryCloseIcon />
                  </StyledIconButton>
                </Title>
                <TabsContainer>
                  {tabs.map((tab) => (
                    <Card key={tab.id}>
                      <StyledIconButton
                        onClick={() => handleCloseTab(tab)}
                        size="large"
                        className="close_tab_btn"
                      >
                        <SecondaryCloseIcon />
                      </StyledIconButton>
                      <img
                        src={tab.screenshot || tab.icon}
                        alt={tab.title}
                        width="150"
                        onClick={() => handleOpenTab(tab)}
                      />
                    </Card>
                  ))}
                </TabsContainer>
              </TabGroup>
            );
          })}
        </>
      </StyledContainer>
    </Modal>
  );
};

const StyledContainer = styled(Container)(() => ({
  paddingTop: "6px",
  paddingBottom: "1rem",
  display: "flex",
  flexDirection: "column",
}));

const StyledHeader = styled("div")(() => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  h1: {
    fontWeight: 500,
    fontSize: "28px",
  },
}));

const TabGroup = styled("div")(() => ({
  display: "flex",
  flexDirection: "column",
  marginTop: "0.5rem",
}));

const Title = styled("div")(() => ({
  display: "flex",
  flexDirection: "row",
  margin: "0.5rem 0",
  alignItems: "center",
  "& .label": {
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: "1",
    WebkitBoxOrient: "vertical",
    marginLeft: "0.5rem",
    fontWeight: 600,
  },
}));

const TabsContainer = styled("div")(() => ({
  display: "flex",
  flexDirection: "row",
  flexWrap: "nowrap",
  overflow: "auto",
}));

const Card = styled("div")(() => ({
  padding: "0.75rem",
  paddingTop: "2rem",
  borderRadius: "24px",
  backgroundColor: "#222222",
  minHeight: "170px",
  minWidth: "170px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "5px",
  marginRight: "0.75rem",
  "&:first-of-type": {
    marginLeft: "0.75rem",
  },
  "& > img": {
    borderRadius: "1rem",
  },
  position: "relative",
  "& .close_tab_btn": {
    position: "absolute",
    right: 0,
    top: 0,
    width: 25,
    height: 25,
    transform: "translate(-25%,25%)",
    padding: "2px",
  },
}));

const StyledIconButton = styled(MUIconButton)(() => ({
  width: "44px",
  height: "44px",
  "&:active": {
    backgroundColor: "rgba(251, 251, 251, 0.08)",
  },
}));
