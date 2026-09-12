// SPDX-License-Identifier: Apache-2.0

import type { Notification } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/notification_pb";
import type { ReactNode } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { ListRow } from "@/design/primitives/ListRow";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import {
  useAlerts,
  useMarkAlertRead,
  useMarkAllAlertsRead,
} from "@/features/alerts/hooks";
import { alertHref, alertSubject, alertText } from "@/features/alerts/links";
import { PushCard } from "@/features/alerts/PushCard";
import { useEvents } from "@/features/events/hooks";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { formatShortTime } from "@/lib/format";

// The alerts (plan 09u): the person's notifications, newest first as the
// server lists them, unread marked the Board's way (a dot, full ink). A tap
// marks the one read and opens what it is about; "Mark all read" in the
// header. Navigation is the route's job.

export interface AlertsScreenProps {
  onBack: () => void;
  onOpen: (href: string) => void;
}

export function AlertsScreen(props: AlertsScreenProps) {
  const alerts = useAlerts();
  const events = useEvents();
  const markRead = useMarkAlertRead();
  const markAll = useMarkAllAlertsRead();
  const unread = Number(alerts.data?.unread ?? 0);

  return (
    <Box flex={1} bg="background">
      <ScreenHeader
        title="Alerts"
        back={{ label: "Back", onPress: props.onBack }}
        right={
          unread > 0 ? (
            <View style={styles.centre}>
              <TextButton
                label="Mark all read"
                onPress={() => {
                  void markAll.mutateAsync({}).catch(() => undefined);
                }}
                testID="alerts-mark-all"
              />
            </View>
          ) : null
        }
      />
      <PushCard />
      {renderBody(alerts, (n) => {
        if (!n.read) {
          void markRead
            .mutateAsync({ notificationId: n.id })
            .catch(() => undefined);
        }
        const href = alertHref(n, events.data?.events ?? []);
        if (href) {
          props.onOpen(href);
        }
      })}
    </Box>
  );
}

function renderBody(
  alerts: ReturnType<typeof useAlerts>,
  onPress: (n: Notification) => void,
): ReactNode {
  if (alerts.isLoading) {
    return <LoadingState />;
  }
  if (alerts.error) {
    return (
      <ErrorState
        error={toAppError(alerts.error)}
        onRetry={() => {
          void alerts.refetch();
        }}
      />
    );
  }
  const items = alerts.data?.notifications ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="No alerts yet"
        message="A mention, an incident you are added to, or a request for your report shows here."
      />
    );
  }
  return (
    <FlatList
      style={styles.fill}
      data={items}
      keyExtractor={(n) => String(n.id)}
      renderItem={({ item }) => (
        <AlertRow alert={item} onPress={() => onPress(item)} />
      )}
      testID="alerts-list"
    />
  );
}

function AlertRow(props: { alert: Notification; onPress: () => void }) {
  const { alert, onPress } = props;
  const theme = useTheme();
  return (
    <ListRow
      title={alertText(alert)}
      subtitle={alertSubject(alert)}
      onPress={onPress}
      testID={`alert-row-${alert.id}`}
      lead={
        <View
          accessible={!alert.read}
          accessibilityLabel={alert.read ? undefined : "Unread"}
          style={[
            styles.dot,
            {
              backgroundColor: alert.read
                ? "transparent"
                : theme.colors.primary,
            },
          ]}
        />
      }
      right={
        <Text variant="caption" color="textMuted">
          {formatShortTime(alert.created)}
        </Text>
      }
      meta={
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {alert.event}
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
});
