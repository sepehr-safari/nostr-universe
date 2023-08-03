import React, { useContext } from "react";
import { styled } from "@mui/material";

import { ProfileAvatar } from "./ProfileAvatar";
import { defaultUserImage } from "../../assets";
import { Tools } from "./tools/Tools";
import { AppContext } from "../../store/app-context";
import { getShortenText } from "../../utils/helpers/general";
import { nip19 } from "nostr-tools";
import { AccountsMenu } from "./accounts-menu/AccountsMenu";
import { useSearchParams } from "react-router-dom";

const MODAL_SEARCH_PARAM = "change-account";

const getEncodedKeys = (keys) => {
  if (!keys || keys.length === 0) {
    return [];
  }
  return keys.map((key) => nip19.npubEncode(key));
};

export const Profile = () => {
  const contextData = useContext(AppContext);
  const { npub, keys, onSelectKey } = contextData || {};

  const [searchParams, setSearchParams] = useSearchParams();
  const isChangeAccountModalOpen = Boolean(
    searchParams.get(MODAL_SEARCH_PARAM)
  );

  const changeAccountHandler = () => {
    searchParams.set(MODAL_SEARCH_PARAM, true);
    setSearchParams(searchParams);
  };

  const closeModalHandler = () => {
    searchParams.delete(MODAL_SEARCH_PARAM);
    setSearchParams(searchParams);
  };

  const currentUsername = npub ? getShortenText(npub) : "No chosen key";
  const encodedKeys = getEncodedKeys(keys);

  return (
    <>
      <Container>
        <ProfileAvatar
          username={currentUsername}
          profileImage={defaultUserImage}
          onChangeAccount={changeAccountHandler}
        />
        <Tools />
      </Container>

      <AccountsMenu
        isOpen={isChangeAccountModalOpen}
        onClose={closeModalHandler}
        accounts={encodedKeys}
        currentUsername={npub}
      />
    </>
  );
};

const Container = styled("div")(() => ({
  display: "flex",
  flexDirection: "column",
  height: "100%",
}));
