import React, { useCallback, useContext, useState } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, rectSwappingStrategy } from "@dnd-kit/sortable";
import { SortableTabItem } from "./SortableTabItem";

import { styled } from "@mui/material";
import { AppContext } from "../../store/app-context";

export const SortableTabsList = () => {
  const [activeId, setActiveId] = useState(null);

  const contextData = useContext(AppContext);
  const { currentWorkspace, onOpenTabGroup, swapTabs } = contextData || {};
  const { tabGroups = {} } = currentWorkspace || {};

  // @TODO change order property at pins and tabs
  const keys = Object.keys(tabGroups).sort((a, b) => {
    return tabGroups[a].info.order - tabGroups[b].info.order;
  });
  console.log(
    {
      keys,
      tabGroups,
    },
    "KEYS&TAB_GROUPS"
  );

  const onSortEnd = useCallback(({ from, to }) => {
    swapTabs(from, to);
  }, []);

  // const getIndex = (id) => keys.indexOf(id);

  const mouseSensor = useSensor(MouseSensor, {
    // Require the mouse to move by 10 pixels before activating.
    // Slight distance prevents sortable logic messing with
    // interactive elements in the handler toolbar component.
    activationConstraint: {
      distance: 10,
    },
  });
  const touchSensor = useSensor(TouchSensor, {
    // Press delay of 250ms, with tolerance of 5px of movement.
    activationConstraint: {
      delay: 300,
      tolerance: 5,
    },
  });
  const sensors = useSensors(mouseSensor, touchSensor);

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      onDragStart={({ active }) => {
        // console.log(active, "onDragStart");
        if (active) {
          setActiveId(active.id);
        }
      }}
      onDragEnd={({ active, over }) => {
        console.log(
          {
            active,
            over,
            from: tabGroups[active.id],
            to: tabGroups[over.id],
            tabGroups,
          },
          "onDragEnd"
        );
        if (over && active.id !== over.id) {
          onSortEnd({
            from: active.id,
            to: over.id,
          });
        }
        setActiveId(null);
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={keys} strategy={rectSwappingStrategy}>
        <TabsContainer>
          {keys.map((id, index) => {
            const tg = tabGroups[id];
            return (
              <SortableTabItem
                image={tg.info.icon}
                {...tg.info}
                key={`item-${tg.info.id}`}
                id={id}
                activeId={activeId}
                onClick={() => onOpenTabGroup(tg)}
                isActive={tg.tabs.length > 0}
              />
            );
          })}
        </TabsContainer>
      </SortableContext>
    </DndContext>
  );
};

const TabsContainer = styled("div")(({ length }) => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(56px, 1fr))`,
  gap: "1rem",
  padding: "1rem",
  overflowY: "hidden",
  "& > .item": {
    width: "100%",
    minHeight: "56px",
  },
}));
