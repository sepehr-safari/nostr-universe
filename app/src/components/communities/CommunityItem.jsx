import React from "react";
import { Avatar, styled } from "@mui/material";
import { getRenderedUsername } from "../../utils/helpers/general";
import { useOptimizedMediaSource } from "../../hooks/useOptimizedMediaSource";
import { formatTime } from "../../utils/helpers/general"

export const CommunityItem = ({ author = {}, content, onClick }) => {
  const { pubkey, picture } = author;
  const renderedName = getRenderedUsername(author, pubkey);
  const authorAvatar = useOptimizedMediaSource({
    pubkey: content.pubkey,
    originalImage: picture,
  });

  const avatar = content.image || authorAvatar;
  const name = ("/" + content.name) || renderedName;
  const title = content.posts ? ("+" + content.posts + " posts") : (content.moderators.length + " moderators");
  const desc = content.description || '';
  const tm = formatTime(content.last_post_tm || content.created_at);
  
  return (
    <Card onClick={() => onClick(content)}>
      <Header>
        <StyledAvatar alt={name} src={avatar} variant="rounded" />
        <Username>{name}</Username>
        <Status>{tm}</Status>
      </Header>
      <Body>
	<TitleText>{title}</TitleText>
	<DescriptionText>{desc}</DescriptionText>
      </Body>
    </Card>
  );
};
const Card = styled("div")(() => ({
  padding: "0.5rem 0.75rem 0.75rem",
  borderRadius: "1rem",
  backgroundColor: "#222222",
  minWidth: "223px",
  maxHeight: "126px",
  maxWidth: "223px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  marginRight: "0.75rem",
  "&:first-of-type": {
    marginLeft: "0.75rem",
  },
}));

const Header = styled("div")(() => ({
  display: "flex",
  alignItems: "center",
  width: "100%",
  flex: "1",
  gap: "0.5rem",
}));

const Username = styled("span")(() => ({
  flex: "3",
  fontSize: "0.875rem",
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  display: "-webkit-box",
  WebkitLineClamp: "1",
  WebkitBoxOrient: "vertical",
}));

const Status = styled("span")(() => ({
  flexShrink: "1",
  fontSize: "0.7rem",
  fontWeight: 400,
  textAlign: "end",
}));

const Body = styled("div")(() => ({
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  flexGrow: "1",
}));

const TitleText = styled("p")(() => ({
  overflow: "hidden",
  margin: "0",
  textOverflow: "ellipsis",
  display: "-webkit-box",
  WebkitLineClamp: "1",
  WebkitBoxOrient: "vertical",
  fontSize: "0.875rem",
  fontWeight: 600,
}));

const DescriptionText = styled("p")(() => ({
  overflow: "hidden",
  margin: "0",
  textOverflow: "ellipsis",
  display: "-webkit-box",
  WebkitLineClamp: "2",
  WebkitBoxOrient: "vertical",
  fontSize: "0.8rem",
  fontWeight: 200,
  color: "#C9C9C9",
}));

const StyledAvatar = styled(Avatar)(() => ({
  maxWidth: "32px",
  maxHeight: "32px",
}));
